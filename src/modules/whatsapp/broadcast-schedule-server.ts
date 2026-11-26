import "server-only";
import {createHash} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {currentWhatsAppAccount} from "./account-scope";
import {batchAddress} from "./batch-recipients";
import {validBroadcastTime,type BroadcastScheduleInput} from "./broadcast-policy";
export class BroadcastScheduleError extends Error {constructor(message:string,public status=409){super(message);}}
export type BroadcastActor={organizationId:string;userId:string;role:string};
export type ScheduledTarget={clientId:string;ticketId:string;address:string};
export type BroadcastJob={id:string;organizationId:string;userId:string;accountRecipient:string;name:string;body:string;recipients:ScheduledTarget[];scheduledAt:Date;status:string;acknowledgedIds:string[];leaseId:string|null;leaseUntil:Date|null;lastError:string|null};
export async function scheduleBroadcast(actor:BroadcastActor,input:BroadcastScheduleInput,now=new Date()){
 const account=await currentWhatsAppAccount(actor.organizationId);if(!account.recipient)throw new BroadcastScheduleError("Conecte o WhatsApp antes de agendar.");
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${actor.organizationId}:${actor.userId}:${input.id}`}))`;
  const [existing]=await tx.$queryRaw<BroadcastJob[]>(Prisma.sql`SELECT * FROM "WhatsAppBroadcastSchedule" WHERE id=${input.id} AND "organizationId"=${actor.organizationId} AND "userId"=${actor.userId}`);
  if(existing){const keys=(rows:Array<{clientId:string;ticketId:string}>)=>rows.map(r=>JSON.stringify([r.clientId,r.ticketId])).sort().join(";");if(existing.body!==input.content||existing.name!==input.name||+existing.scheduledAt!==+new Date(input.scheduledAt)||existing.accountRecipient!==account.recipient||keys(existing.recipients)!==keys(input.recipients))throw new BroadcastScheduleError("Esta tentativa já foi salva com outros dados. Reabra o envio para criar outro agendamento.");return {id:existing.id,status:existing.status,scheduledAt:existing.scheduledAt};}
  if(!validBroadcastTime(input.scheduledAt,now))throw new BroadcastScheduleError("Escolha um horário com pelo menos 1 minuto de antecedência e até um ano à frente.",400);
  if(await tx.whatsAppBatchDelivery.count({where:{organizationId:actor.organizationId,userId:actor.userId,batchId:input.id}}))throw new BroadcastScheduleError("Este lote já foi preparado para envio imediato. Crie um novo agendamento.");
  const tickets=await tx.serviceTicket.findMany({where:{...account.where,id:{in:input.recipients.map(r=>r.ticketId)},mergedIntoId:null,isSpam:false,status:{not:"SPAM"},client:{active:true}},select:{id:true,clientId:true,senderEmail:true,senderName:true,subject:true,client:{select:{name:true}}}});
  const targets=input.recipients.map(row=>{const ticket=tickets.find(t=>t.id===row.ticketId&&t.clientId===row.clientId);return ticket?{clientId:row.clientId,ticketId:row.ticketId,address:batchAddress(ticket.senderEmail)}:null;});
  if(targets.some(t=>!t)||new Set(targets.map(t=>t?.address)).size!==targets.length)throw new BroadcastScheduleError("Um contato foi alterado, está duplicado ou não está disponível. Confira os destinatários antes de agendar.");
  const scheduledAt=new Date(input.scheduledAt);
  const fingerprint=createHash("sha256").update(JSON.stringify([actor.organizationId,actor.userId,account.recipient,input.content,scheduledAt.toISOString(),targets.map(t=>JSON.stringify([t!.clientId,t!.address])).sort()])).digest("hex");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"broadcast-intent:"+fingerprint}))`;
  const [duplicate]=await tx.$queryRaw<BroadcastJob[]>(Prisma.sql`SELECT * FROM "WhatsAppBroadcastSchedule" WHERE "organizationId"=${actor.organizationId} AND "userId"=${actor.userId} AND fingerprint=${fingerprint} AND status<>'CANCELLED'`);
  if(duplicate)return {id:duplicate.id,status:duplicate.status,scheduledAt:duplicate.scheduledAt};
  await tx.$executeRaw(Prisma.sql`INSERT INTO "WhatsAppBroadcastSchedule" (id,"organizationId","userId","accountRecipient",name,body,recipients,"scheduledAt",fingerprint) VALUES (${input.id},${actor.organizationId},${actor.userId},${account.recipient},${input.name},${input.content},${JSON.stringify(targets)}::jsonb,${scheduledAt},${fingerprint})`);
  await tx.whatsAppBatchDelivery.createMany({data:tickets.map(t=>({organizationId:actor.organizationId,userId:actor.userId,batchId:input.id,ticketId:t.id,accountRecipient:account.recipient!,recipientName:`${t.client!.name} · ${t.senderName||t.subject}`,body:input.content}))});
  return {id:input.id,status:"SCHEDULED",scheduledAt};
 },{maxWait:10000,timeout:30000});
}
const management=(actor:BroadcastActor)=>["MASTER","ADMIN","MANAGER"].includes(actor.role);
export async function listBroadcastSchedules(actor:BroadcastActor){
 return prisma.$queryRaw<Array<{id:string;name:string;scheduledAt:Date;status:string;lastError:string|null;body:string;total:number;sent:number;pending:number;uncertain:number;cancelled:number;operator:string}>>(Prisma.sql`SELECT s.id,s.name,s."scheduledAt",s.status,s."lastError",s.body,jsonb_array_length(s.recipients)::int AS total,COALESCE(u.name,u.email,'Operador') AS operator,
  COUNT(d.id) FILTER (WHERE d.status='SENT')::int AS sent,COUNT(d.id) FILTER (WHERE d.status='PENDING')::int AS pending,COUNT(d.id) FILTER (WHERE d.status IN ('UNKNOWN','SENDING'))::int AS uncertain,COUNT(d.id) FILTER (WHERE d.status='CANCELLED')::int AS cancelled
  FROM "WhatsAppBroadcastSchedule" s LEFT JOIN "User" u ON u.id=s."userId" LEFT JOIN "WhatsAppBatchDelivery" d ON d."batchId"=s.id AND d."organizationId"=s."organizationId" AND d."userId"=s."userId"
  WHERE s."organizationId"=${actor.organizationId} AND (${management(actor)} OR s."userId"=${actor.userId}) GROUP BY s.id,u.name,u.email ORDER BY s."createdAt" DESC,s.id LIMIT 100`);
}
export async function broadcastScheduleDetails(actor:BroadcastActor,id:string){
 const [job]=await prisma.$queryRaw<BroadcastJob[]>(Prisma.sql`SELECT * FROM "WhatsAppBroadcastSchedule" WHERE id=${id} AND "organizationId"=${actor.organizationId} AND (${management(actor)} OR "userId"=${actor.userId})`);
 if(!job)throw new BroadcastScheduleError("Agendamento não encontrado.",404);
 return {name:job.name,deliveries:await prisma.whatsAppBatchDelivery.findMany({where:{organizationId:job.organizationId,userId:job.userId,batchId:job.id},select:{id:true,recipientName:true,status:true,error:true},orderBy:[{createdAt:"asc"},{id:"asc"}]})};
}
export async function changeBroadcastSchedule(actor:BroadcastActor,id:string,action:"cancel"|"resume"){
 return prisma.$transaction(async tx=>{
  const [job]=await tx.$queryRaw<BroadcastJob[]>(Prisma.sql`SELECT * FROM "WhatsAppBroadcastSchedule" WHERE id=${id} AND "organizationId"=${actor.organizationId} AND (${management(actor)} OR "userId"=${actor.userId}) FOR UPDATE`);
  if(!job)throw new BroadcastScheduleError("Agendamento não encontrado.",404);
  const scope={organizationId:job.organizationId,userId:job.userId,batchId:job.id};
  if(action==="cancel"){
   if(["COMPLETED","PARTIAL","CANCELLED"].includes(job.status))return {status:job.status};
   await tx.$executeRaw(Prisma.sql`UPDATE "WhatsAppBroadcastSchedule" SET status='CANCELLED',"leaseId"=NULL,"leaseUntil"=NULL,"completedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE id=${job.id}`);
   await tx.whatsAppBatchDelivery.updateMany({where:{...scope,status:"PENDING"},data:{status:"CANCELLED",error:"Agendamento cancelado."}});return {status:"CANCELLED"};
  }
  if(job.status!=="PAUSED")throw new BroadcastScheduleError("Somente agendamentos pausados podem ser retomados.");
  // Unknown provider outcomes remain non-retryable; resuming acknowledges and skips them.
  const unknown=await tx.whatsAppBatchDelivery.findMany({where:{...scope,status:{in:["UNKNOWN","SENDING"]}},select:{id:true}});
  await tx.whatsAppBatchDelivery.updateMany({where:{...scope,status:"SENDING"},data:{status:"UNKNOWN",error:"Confirmação pendente do envio anterior. Não será reenviado automaticamente."}});
  await tx.$executeRaw(Prisma.sql`UPDATE "WhatsAppBroadcastSchedule" SET status='SCHEDULED',"acknowledgedIds"=${JSON.stringify(unknown.map(d=>d.id))}::jsonb,"leaseId"=NULL,"leaseUntil"=NULL,"lastError"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE id=${job.id}`);
  return {status:"SCHEDULED"};
 },{timeout:15000});
}
