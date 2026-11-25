import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {brazilDay,shiftDay} from "@/modules/operations/analytics";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "./operator-report-server";
import {reportChatMessages,type OperatorDayReport} from "./operator-report-model";
import {createOperatorReportPdf,operatorPdfName} from "./operator-report-pdf";
import {readReportSpace,reportChatAccessToken,reportGoogleStatus,validReportSpace} from "./operator-report-google";
type Config={organizationId:string;revision:string;configuredById:string;destinationName:string;spaceName:string|null;enabled:boolean;updatedAt:Date};
type AttachmentRef={resourceName?:string;attachmentUploadToken?:string};
function attachmentRef(value:unknown):AttachmentRef{
 if(!value||typeof value!=="object")throw new Error("O Google Chat não confirmou o anexo.");
 const ref=value as AttachmentRef;
 if(!(typeof ref.resourceName==="string"&&ref.resourceName.length>0||typeof ref.attachmentUploadToken==="string"&&ref.attachmentUploadToken.length>0))throw new Error("O Google Chat não confirmou o anexo.");
 return {...(typeof ref.resourceName==="string"?{resourceName:ref.resourceName}:{}),...(typeof ref.attachmentUploadToken==="string"?{attachmentUploadToken:ref.attachmentUploadToken}:{})};
}
export async function reportConfig(organizationId:string,userId:string){
 const [config]=await prisma.$queryRaw<Config[]>(Prisma.sql`SELECT "organizationId",revision,"configuredById","destinationName","spaceName",enabled,"updatedAt" FROM "OperatorReportConfig" WHERE "organizationId"=${organizationId}`);
 const [last]=await prisma.$queryRaw<Array<{day:string;status:string;sentAt:Date|null;lastError:string|null}>>(Prisma.sql`SELECT day,status,"sentAt","lastError" FROM "OperatorReportDelivery" WHERE "organizationId"=${organizationId} ORDER BY day DESC LIMIT 1`);
 return {configured:Boolean(config?.spaceName),revision:config?.revision||null,destinationName:config?.destinationName||"",spaceName:config?.spaceName||null,enabled:config?.enabled||false,updatedAt:config?.updatedAt||null,last:last||null,google:await reportGoogleStatus(organizationId,userId)};
}
export async function saveReportConfig(input:{organizationId:string;userId:string;spaceName:string;enabled:boolean}){
 const token=await reportChatAccessToken(input.organizationId,input.userId),space=await readReportSpace(token,input.spaceName),revision=randomUUID();
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw(Prisma.sql`INSERT INTO "OperatorReportConfig" ("organizationId",revision,"configuredById","destinationName","spaceName",enabled,"updatedAt") VALUES (${input.organizationId},${revision},${input.userId},${space.displayName},${space.name},${input.enabled},CURRENT_TIMESTAMP)
   ON CONFLICT ("organizationId") DO UPDATE SET revision=EXCLUDED.revision,"configuredById"=EXCLUDED."configuredById","destinationName"=EXCLUDED."destinationName","spaceName"=EXCLUDED."spaceName",enabled=EXCLUDED.enabled,"updatedAt"=EXCLUDED."updatedAt"`);
  await tx.auditLog.create({data:{userId:input.userId,action:"OPERATOR_REPORT_CONFIGURED",entity:"Organization",entityId:input.organizationId,afterData:{destinationName:space.displayName,spaceName:space.name,enabled:input.enabled,format:"PDF",revision}}});
 });return reportConfig(input.organizationId,input.userId);
}
export async function disableReportConfig(organizationId:string,userId:string){
 await prisma.$transaction(async tx=>{await tx.$executeRaw(Prisma.sql`UPDATE "OperatorReportConfig" SET enabled=false,revision=${randomUUID()},"updatedAt"=CURRENT_TIMESTAMP WHERE "organizationId"=${organizationId}`);await tx.auditLog.create({data:{userId,action:"OPERATOR_REPORT_DISABLED",entity:"Organization",entityId:organizationId}});});return reportConfig(organizationId,userId);
}
export function chatRequestId(organizationId:string,day:string,part=0){const hex=createHash("sha256").update(`fortuno-operator-pdf:${organizationId}:${day}:${part}`).digest("hex");return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;}
export async function uploadReportPdf(token:string,spaceName:string,day:string,pdf:Uint8Array){
 if(!validReportSpace(spaceName)||pdf.length>20*1024*1024||Buffer.from(pdf.subarray(0,5)).toString()!=="%PDF-")throw new Error("PDF ou espaço inválido.");
 const boundary="fortuno_"+randomUUID(),name=operatorPdfName(day);
 const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({filename:name})}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),Buffer.from(pdf),Buffer.from(`\r\n--${boundary}--\r\n`)]);
 const response=await fetch(`https://chat.googleapis.com/upload/v1/${spaceName}/attachments:upload?uploadType=multipart`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":`multipart/related; boundary=${boundary}`},body:new Uint8Array(body),redirect:"error",signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error("Não foi possível carregar o PDF no Google Chat.");const result=await response.json();return attachmentRef(result.attachmentDataRef);
}
export async function postReportPdf(token:string,spaceName:string,text:string,ref:AttachmentRef,requestId:string){
 if(!validReportSpace(spaceName))throw new Error("Espaço inválido.");const url=new URL(`https://chat.googleapis.com/v1/${spaceName}/messages`);url.searchParams.set("requestId",requestId);
 const response=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({text,attachment:[{attachmentDataRef:attachmentRef(ref)}]}),redirect:"error",signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error("Não foi possível confirmar a entrega do PDF.");const result=await response.json();if(typeof result.name!=="string"||!result.name.startsWith(spaceName+"/messages/"))throw new Error("O Google Chat não confirmou a mensagem.");
}
export async function processDailyOperatorReports(now=new Date()){
 const today=brazilDay(now),cutoff=new Date(`${today}T08:00:00-03:00`);if(now<cutoff)return;const day=shiftDay(today,-1);
 const configs=await prisma.$queryRaw<Config[]>(Prisma.sql`SELECT "organizationId",revision,"configuredById","destinationName","spaceName",enabled,"updatedAt" FROM "OperatorReportConfig" WHERE enabled=true AND "spaceName" IS NOT NULL AND "updatedAt"<=${cutoff} ORDER BY "organizationId" LIMIT 50`);
 for(const config of configs){let leaseId:string|undefined;try{
  if(!config.spaceName||!validReportSpace(config.spaceName))continue;
  const member=await prisma.organizationMember.findFirst({where:{organizationId:config.organizationId,userId:config.configuredById,role:{in:["MASTER","ADMIN"]}},select:{id:true,userId:true,organizationId:true,role:true}});if(!member)continue;
  const permission=await getRolePermissions(member.organizationId,member.role);if(!permission.MANAGEMENT.canView||!permission.MANAGEMENT.canManage||!permission.MANAGEMENT.canExport)continue;
  const [existing]=await prisma.$queryRaw<Array<{status:string;configRevision:string;snapshot:OperatorDayReport}>>(Prisma.sql`SELECT status,"configRevision",snapshot FROM "OperatorReportDelivery" WHERE "organizationId"=${config.organizationId} AND day=${day}`);
  if(existing?.status==="SENT"||existing&&existing.configRevision!==config.revision)continue;
  if(existing&&((existing.snapshot.available.whatsapp&&!permission.WHATSAPP.canView)||(existing.snapshot.available.operations&&!permission.OPERATIONS.canView)||(existing.snapshot.available.daily&&!permission.DAILY_ACTIVITIES.canView)))continue;
  if(!existing){const snapshot=await buildOperatorDayReport(member,day,now),messages=reportChatMessages(snapshot);await prisma.$executeRaw(Prisma.sql`INSERT INTO "OperatorReportDelivery" ("organizationId",day,"configRevision",snapshot,messages) VALUES (${config.organizationId},${day},${config.revision},${JSON.stringify(snapshot)}::jsonb,${JSON.stringify(messages)}::jsonb) ON CONFLICT ("organizationId",day) DO NOTHING`);}
  leaseId=randomUUID();
  const [delivery]=await prisma.$queryRaw<Array<{messages:string[];snapshot:OperatorDayReport;pdfBase64:string|null;attachmentRef:AttachmentRef|null;sentParts:number}>>(Prisma.sql`UPDATE "OperatorReportDelivery" d SET status='SENDING',"leaseId"=${leaseId},"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes',attempts=attempts+1
   WHERE d."organizationId"=${config.organizationId} AND day=${day} AND "configRevision"=${config.revision} AND status IN ('READY','FAILED','SENDING') AND attempts<8
   AND ("leaseUntil" IS NULL OR "leaseUntil"<CURRENT_TIMESTAMP) AND ("retryAt" IS NULL OR "retryAt"<=CURRENT_TIMESTAMP)
   AND EXISTS(SELECT 1 FROM "OperatorReportConfig" c WHERE c."organizationId"=d."organizationId" AND c.enabled=true AND c.revision=d."configRevision") RETURNING messages,snapshot,"pdfBase64","attachmentRef","sentParts"`);if(!delivery)continue;
  const allowed=()=>prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" d SET "leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '2 minutes' WHERE d."organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId} AND EXISTS(SELECT 1 FROM "OperatorReportConfig" c WHERE c."organizationId"=d."organizationId" AND c.enabled=true AND c.revision=d."configRevision")`);
  const token=await reportChatAccessToken(config.organizationId,config.configuredById);
  if(!delivery.pdfBase64){delivery.pdfBase64=Buffer.from(createOperatorReportPdf(delivery.snapshot).output("arraybuffer")).toString("base64");const saved=await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET "pdfBase64"=${delivery.pdfBase64} WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`);if(!saved)throw new Error("PDF não confirmado.");}
  if(!delivery.attachmentRef){if(!await allowed())throw new Error("Configuração alterada.");delivery.attachmentRef=await uploadReportPdf(token,config.spaceName,day,Buffer.from(delivery.pdfBase64,"base64"));const saved=await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET "attachmentRef"=${JSON.stringify(delivery.attachmentRef)}::jsonb WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`);if(!saved)throw new Error("Anexo não confirmado.");}
  if(!await allowed())throw new Error("Configuração alterada.");
  await postReportPdf(token,config.spaceName,delivery.messages[0],delivery.attachmentRef,chatRequestId(config.organizationId,day));
  await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET status='SENT',"sentParts"=1,"sentAt"=CURRENT_TIMESTAMP,"lastError"=NULL,"leaseId"=NULL,"leaseUntil"=NULL WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`);
 }catch{if(leaseId)await prisma.$executeRaw(Prisma.sql`UPDATE "OperatorReportDelivery" SET status='FAILED',"lastError"='Entrega do PDF não confirmada. Confira a conexão Google e o espaço de gestores.',"retryAt"=CURRENT_TIMESTAMP+INTERVAL '5 minutes',"leaseId"=NULL,"leaseUntil"=NULL WHERE "organizationId"=${config.organizationId} AND day=${day} AND "leaseId"=${leaseId}`).catch(()=>undefined);}}
}
