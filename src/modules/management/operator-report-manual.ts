import "server-only";
import {randomUUID} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import type {AssistantMember} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {OperatorChatError} from "./operator-chat-error";
import {chatRequestId,postReportPdf,uploadReportPdf} from "./operator-report-delivery";
import {reportChatAccessToken,validReportSpace} from "./operator-report-google";
import {reportChatMessages,reportPeriod,type OperatorDayReport} from "./operator-report-model";
import {createOperatorReportPdf} from "./operator-report-pdf";
import {buildOperatorDayReport} from "./operator-report-server";

type Member=Pick<AssistantMember,"id"|"organizationId"|"userId"|"role">;
type Config={revision:string;configuredById:string;destinationName:string;spaceName:string|null};
type Delivery={requestId:string;requestedById:string;day:string;configRevision:string;destinationName:string;status:string;attempts:number;snapshot:OperatorDayReport;messages:string[];pdfBase64:string|null;attachmentRef:Parameters<typeof postReportPdf>[3]|null;sentAt:Date|null};
const failure=()=>new OperatorChatError("REPORT_DELIVERY_UNCONFIRMED","Não foi possível confirmar o envio do PDF. Clique em Enviar agora para retomar a mesma tentativa com segurança.",503);
const allowedReport=(permissions:Awaited<ReturnType<typeof getRolePermissions>>,report:OperatorDayReport)=>
 permissions.MANAGEMENT.canView&&permissions.MANAGEMENT.canManage&&permissions.MANAGEMENT.canExport&&
 (!report.available.whatsapp||permissions.WHATSAPP.canView)&&(!report.available.operations||permissions.OPERATIONS.canView)&&(!report.available.daily||permissions.DAILY_ACTIVITIES.canView);

export async function sendManualOperatorReport(member:Member,input:{day:string;requestId:string;revision:string},now=new Date()){
 reportPeriod(input.day,now);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId))throw new OperatorChatError("REPORT_REQUEST_INVALID","Tentativa de envio inválida.",400);
 const permissions=await getRolePermissions(member.organizationId,member.role);
 if(!["MASTER","ADMIN"].includes(member.role)||!permissions.MANAGEMENT.canView||!permissions.MANAGEMENT.canManage||!permissions.MANAGEMENT.canExport)throw new OperatorChatError("REPORT_PERMISSION_DENIED","Sem permissão para enviar relatórios da equipe.",403);
 const [config]=await prisma.$queryRaw<Config[]>(Prisma.sql`SELECT revision,"configuredById","destinationName","spaceName" FROM "OperatorReportConfig" WHERE "organizationId"=${member.organizationId}`);
 if(!config?.spaceName||!validReportSpace(config.spaceName))throw new OperatorChatError("REPORT_DESTINATION_REQUIRED","Configure o espaço do Google Chat antes de enviar.",409);
 if(config.revision!==input.revision)throw new OperatorChatError("REPORT_CONFIG_CHANGED","O destino foi alterado. Atualize o relatório e confira o espaço antes de enviar.",409);
 const sender=await prisma.organizationMember.findFirst({where:{organizationId:member.organizationId,userId:config.configuredById,role:{in:["MASTER","ADMIN"]}},select:{id:true,userId:true,organizationId:true,role:true}});
 if(!sender)throw new OperatorChatError("REPORT_SENDER_UNAVAILABLE","A conta responsável pelo envio não está mais autorizada. Configure a entrega novamente.",403);
 const senderPermissions=await getRolePermissions(sender.organizationId,sender.role);
 const [existing]=await prisma.$queryRaw<Delivery[]>(Prisma.sql`SELECT * FROM "OperatorReportManualDelivery" WHERE "organizationId"=${member.organizationId} AND "requestId"=${input.requestId}::uuid`);
 if(existing&&(existing.day!==input.day||existing.requestedById!==member.userId||existing.configRevision!==config.revision))throw new OperatorChatError("REPORT_REQUEST_CONFLICT","Esta tentativa pertence a outro envio. Atualize o relatório.",409);
 const snapshot=existing?.snapshot||await buildOperatorDayReport(member,input.day,now);
 if(!allowedReport(permissions,snapshot)||!allowedReport(senderPermissions,snapshot))throw new OperatorChatError("REPORT_PERMISSION_CHANGED","As permissões atuais não permitem enviar todos os indicadores deste relatório.",403);
 const leaseId=randomUUID();
 const delivery=await prisma.$transaction(async tx=>{
  // Serialize claims across tabs/users, without keeping a transaction open during Google requests.
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${"operator-report-manual:"+member.organizationId}))`);
  const [current]=await tx.$queryRaw<Config[]>(Prisma.sql`SELECT revision FROM "OperatorReportConfig" WHERE "organizationId"=${member.organizationId} FOR SHARE`);
  if(current?.revision!==config.revision)throw new OperatorChatError("REPORT_CONFIG_CHANGED","O destino foi alterado. Atualize o relatório antes de enviar.",409);
  await tx.$executeRaw(Prisma.sql`INSERT INTO "OperatorReportManualDelivery" ("organizationId","requestId","requestedById",day,"configRevision","destinationName",snapshot,messages)
   VALUES (${member.organizationId},${input.requestId}::uuid,${member.userId},${input.day},${config.revision},${config.destinationName},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(reportChatMessages(snapshot))}::jsonb) ON CONFLICT ("organizationId","requestId") DO NOTHING`);
  const [saved]=await tx.$queryRaw<Delivery[]>(Prisma.sql`SELECT * FROM "OperatorReportManualDelivery" WHERE "organizationId"=${member.organizationId} AND "requestId"=${input.requestId}::uuid FOR UPDATE`);
  if(!saved||saved.day!==input.day||saved.requestedById!==member.userId||saved.configRevision!==config.revision)throw new OperatorChatError("REPORT_REQUEST_CONFLICT","Esta tentativa pertence a outro envio.",409);
  if(saved.status==="SENT")return saved;
  const [active]=await tx.$queryRaw<Array<{active:boolean}>>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM "OperatorReportManualDelivery" WHERE "organizationId"=${member.organizationId} AND status='SENDING' AND "leaseUntil">CURRENT_TIMESTAMP) AS active`);
  if(active?.active)throw new OperatorChatError("REPORT_ALREADY_SENDING","Um envio manual está em andamento. Aguarde a confirmação antes de tentar novamente.",409);
  const [claimed]=await tx.$queryRaw<Delivery[]>(Prisma.sql`UPDATE "OperatorReportManualDelivery" SET status='SENDING',attempts=attempts+1,"leaseId"=${leaseId}::uuid,"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes'
   WHERE "organizationId"=${member.organizationId} AND "requestId"=${input.requestId}::uuid AND status IN ('READY','FAILED','SENDING') AND attempts<8 AND ("leaseUntil" IS NULL OR "leaseUntil"<=CURRENT_TIMESTAMP) RETURNING *`);
  if(!claimed)throw new OperatorChatError("REPORT_ATTEMPTS_EXHAUSTED","Não foi possível retomar esta tentativa. Confira a conexão Google antes de iniciar um novo envio.",409);
  return claimed;
 });
 const result=(alreadySent:boolean,sentAt:Date|string)=>({status:"SENT" as const,alreadySent,day:delivery.day,destinationName:delivery.destinationName,sentAt});
 if(delivery.status==="SENT")return result(true,delivery.sentAt||now);
 const liveLease=Prisma.sql`"organizationId"=${member.organizationId} AND "requestId"=${input.requestId}::uuid AND "leaseId"=${leaseId}::uuid`;
 const allowed=()=>prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportManualDelivery" d SET "leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes' WHERE ${liveLease}
  AND EXISTS(SELECT 1 FROM "OperatorReportConfig" c WHERE c."organizationId"=d."organizationId" AND c.revision=d."configRevision")`);
 try{
  if(!allowedReport(permissions,delivery.snapshot)||!allowedReport(senderPermissions,delivery.snapshot))throw new OperatorChatError("REPORT_PERMISSION_CHANGED","As permissões atuais não permitem enviar este relatório.",403);
  const token=await reportChatAccessToken(member.organizationId,config.configuredById);
  if(!delivery.pdfBase64){delivery.pdfBase64=Buffer.from(createOperatorReportPdf(delivery.snapshot).output("arraybuffer")).toString("base64");
   if(!await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportManualDelivery" SET "pdfBase64"=${delivery.pdfBase64} WHERE ${liveLease}`))throw failure();}
  if(!delivery.attachmentRef){if(!await allowed())throw failure();delivery.attachmentRef=await uploadReportPdf(token,config.spaceName,input.day,Buffer.from(delivery.pdfBase64,"base64"));
   if(!await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportManualDelivery" SET "attachmentRef"=${JSON.stringify(delivery.attachmentRef)}::jsonb WHERE ${liveLease}`))throw failure();}
  if(!await allowed())throw failure();
  await postReportPdf(token,config.spaceName,delivery.messages[0],delivery.attachmentRef,chatRequestId(member.organizationId,"manual:"+input.requestId));
  const sentAt=await prisma.$transaction(async tx=>{
   const [sent]=await tx.$queryRaw<Array<{sentAt:Date}>>(Prisma.sql`UPDATE "OperatorReportManualDelivery" SET status='SENT',"sentAt"=CURRENT_TIMESTAMP,"lastError"=NULL,"leaseId"=NULL,"leaseUntil"=NULL WHERE ${liveLease} RETURNING "sentAt"`);
   if(!sent)throw failure();
   await tx.auditLog.create({data:{userId:member.userId,action:"OPERATOR_REPORT_SENT_MANUALLY",entity:"Organization",entityId:member.organizationId,afterData:{requestId:input.requestId,day:input.day,destinationName:config.destinationName,spaceName:config.spaceName,format:"PDF"}}});
   return sent.sentAt;
  });
  return result(false,sentAt);
 }catch(error){
  await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportManualDelivery" SET status='FAILED',"lastError"='Entrega manual do PDF não confirmada.',"leaseId"=NULL,"leaseUntil"=NULL WHERE ${liveLease}`).catch(()=>undefined);
  throw error instanceof OperatorChatError?error:failure();
 }
}
