import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {encryptIntegrationSecret,decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {brazilDay,shiftDay} from "@/modules/operations/analytics";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "./operator-report-server";
import {googleChatWebhook,reportChatMessages} from "./operator-report-model";
type Config={organizationId:string;revision:string;configuredById:string;destinationName:string;webhookEncrypted:string;enabled:boolean;updatedAt:Date};
export async function reportConfig(organizationId:string){
 const [config]=await prisma.$queryRaw<Array<Omit<Config,"webhookEncrypted">>>(Prisma.sql`SELECT "organizationId",revision,"configuredById","destinationName",enabled,"updatedAt" FROM "OperatorReportConfig" WHERE "organizationId"=${organizationId}`);
 const [last]=await prisma.$queryRaw<Array<{day:string;status:string;sentAt:Date|null;lastError:string|null}>>(Prisma.sql`SELECT day,status,"sentAt","lastError" FROM "OperatorReportDelivery" WHERE "organizationId"=${organizationId} ORDER BY day DESC LIMIT 1`);
 return {configured:Boolean(config),destinationName:config?.destinationName||"",enabled:config?.enabled||false,updatedAt:config?.updatedAt||null,last:last||null};
}
export async function saveReportConfig(input:{organizationId:string;userId:string;destinationName:string;enabled:boolean;webhook?:string}){
 const [existing]=await prisma.$queryRaw<Config[]>(Prisma.sql`SELECT * FROM "OperatorReportConfig" WHERE "organizationId"=${input.organizationId}`);
 const encrypted=input.webhook?encryptIntegrationSecret(googleChatWebhook(input.webhook)):existing?.webhookEncrypted;
 if(!encrypted)throw new Error("Cadastre o webhook do espaço de gestores.");
 const revision=randomUUID();
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw(Prisma.sql`INSERT INTO "OperatorReportConfig" ("organizationId",revision,"configuredById","destinationName","webhookEncrypted",enabled,"updatedAt") VALUES (${input.organizationId},${revision},${input.userId},${input.destinationName},${encrypted},${input.enabled},CURRENT_TIMESTAMP)
   ON CONFLICT ("organizationId") DO UPDATE SET revision=EXCLUDED.revision,"configuredById"=EXCLUDED."configuredById","destinationName"=EXCLUDED."destinationName","webhookEncrypted"=EXCLUDED."webhookEncrypted",enabled=EXCLUDED.enabled,"updatedAt"=EXCLUDED."updatedAt"`);
  await tx.auditLog.create({data:{userId:input.userId,action:"OPERATOR_REPORT_CONFIGURED",entity:"Organization",entityId:input.organizationId,afterData:{destinationName:input.destinationName,enabled:input.enabled,revision}}});
 });
 return reportConfig(input.organizationId);
}
export function chatRequestId(organizationId:string,day:string,part:number){
 const hex=createHash("sha256").update(`fortuno-operator-report:${organizationId}:${day}:${part}`).digest("hex");
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export async function postReportPart(webhook:string,text:string,requestId:string,threadKey:string){
 const url=new URL(googleChatWebhook(webhook));url.searchParams.set("requestId",requestId);url.searchParams.set("messageReplyOption","REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD");
 // Never include the secret URL, provider body or customer content in logs/errors.
 const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,thread:{threadKey}}),redirect:"error",signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error("Não foi possível confirmar a entrega no Google Chat.");
 const result=await response.json();if(typeof result.name!=="string"||!result.name.startsWith("spaces/"))throw new Error("O Google Chat não confirmou a mensagem.");
}
export async function processDailyOperatorReports(now=new Date()){
 const today=brazilDay(now),cutoff=new Date(`${today}T08:00:00-03:00`);if(now<cutoff)return;
 const day=shiftDay(today,-1);
 const configs=await prisma.$queryRaw<Config[]>(Prisma.sql`SELECT * FROM "OperatorReportConfig" WHERE enabled=true AND "updatedAt"<=${cutoff} ORDER BY "organizationId" LIMIT 50`);
 for(const config of configs){
  let leaseId:string|undefined;
  try{
   const member=await prisma.organizationMember.findFirst({where:{organizationId:config.organizationId,userId:config.configuredById,role:{in:["MASTER","ADMIN"]}},select:{id:true,userId:true,organizationId:true,role:true}});
   if(!member)continue;
   const permission=await getRolePermissions(member.organizationId,member.role);
   if(!permission.MANAGEMENT.canView||!permission.MANAGEMENT.canManage)continue;
   const [existing]=await prisma.$queryRaw<Array<{status:string;configRevision:string;snapshot:{available:{whatsapp:boolean;operations:boolean;daily:boolean}}}>>(Prisma.sql`SELECT status,"configRevision",snapshot FROM "OperatorReportDelivery" WHERE "organizationId"=${config.organizationId} AND day=${day}`);
   if(existing?.status==="SENT"||existing&&existing.configRevision!==config.revision)continue;
   if(existing&&((existing.snapshot.available.whatsapp&&!permission.WHATSAPP.canView)||(existing.snapshot.available.operations&&!permission.OPERATIONS.canView)||(existing.snapshot.available.daily&&!permission.DAILY_ACTIVITIES.canView)))continue;
   if(!existing){
    const snapshot=await buildOperatorDayReport(member,day,now),messages=reportChatMessages(snapshot);
    await prisma.$executeRaw(Prisma.sql`INSERT INTO "OperatorReportDelivery" ("organizationId",day,"configRevision",snapshot,messages) VALUES (${config.organizationId},${day},${config.revision},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(messages)}::jsonb) ON CONFLICT ("organizationId",day) DO NOTHING`);
   }
   leaseId=randomUUID();
   const [delivery]=await prisma.$queryRaw<Array<{messages:string[];sentParts:number}>>(Prisma.sql`UPDATE "OperatorReportDelivery" d SET status='SENDING',"leaseId"=${leaseId},"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes',attempts=attempts+1
    WHERE d."organizationId"=${config.organizationId} AND day=${day} AND "configRevision"=${config.revision} AND status IN ('READY','FAILED','SENDING') AND attempts<8
    AND ("leaseUntil" IS NULL OR "leaseUntil"<CURRENT_TIMESTAMP) AND ("retryAt" IS NULL OR "retryAt"<=CURRENT_TIMESTAMP)
    AND EXISTS(SELECT 1 FROM "OperatorReportConfig" c WHERE c."organizationId"=d."organizationId" AND c.enabled=true AND c.revision=d."configRevision") RETURNING messages,"sentParts"`);
   if(!delivery)continue;
   for(let part=delivery.sentParts;part<delivery.messages.length;part++){
    const allowed=await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" d SET "leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes' WHERE d."organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId} AND EXISTS(SELECT 1 FROM "OperatorReportConfig" c WHERE c."organizationId"=d."organizationId" AND c.enabled=true AND c.revision=d."configRevision")`);
    if(!allowed)throw new Error("Entrega interrompida por alteração na configuração.");
    await postReportPart(decryptIntegrationSecret(config.webhookEncrypted),delivery.messages[part],chatRequestId(config.organizationId,day,part),`fortuno-report-${day}`);
    const saved=await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET "sentParts"=${part+1},"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes' WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`);
    if(!saved)throw new Error("Confirmação da entrega pendente.");
   }
   await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET status='SENT',"sentAt"=CURRENT_TIMESTAMP,"lastError"=NULL,"leaseId"=NULL,"leaseUntil"=NULL WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`);
  }catch{
   if(leaseId)await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET status='FAILED',"lastError"='Entrega não confirmada. Nova tentativa automática; confira a configuração do espaço se persistir.',"retryAt"=CURRENT_TIMESTAMP+INTERVAL '5 minutes',"leaseId"=NULL,"leaseUntil"=NULL WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`).catch(()=>undefined);
  }
 }
}
