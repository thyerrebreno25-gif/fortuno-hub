import "server-only";
import {randomUUID} from "node:crypto";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getWhatsAppPermission} from "@/modules/atendimento/auth";
import {deliverBatchMessage} from "./batch-send";
import type {BroadcastJob} from "./broadcast-schedule-server";
async function actorFor(job:BroadcastJob){
 const actor=await prisma.organizationMember.findFirst({where:{organizationId:job.organizationId,userId:job.userId,role:{not:"CLIENT"}},include:{user:{select:{name:true,email:true}}}});
 if(!actor)return null;const permission=await getWhatsAppPermission(job.organizationId,actor.role);return permission.canView&&permission.canEdit?actor:null;
}
export async function processScheduledBroadcasts(now=new Date()){
 const deadline=Date.now()+70000;
 const due=await prisma.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "WhatsAppBroadcastSchedule" WHERE status IN ('SCHEDULED','RUNNING') AND "scheduledAt"<=${now} AND ("leaseUntil" IS NULL OR "leaseUntil"<CURRENT_TIMESTAMP) ORDER BY "scheduledAt",id LIMIT 5`);
 for(const row of due){if(Date.now()>=deadline)break;const leaseId=randomUUID();
  const [job]=await prisma.$queryRaw<BroadcastJob[]>(Prisma.sql`UPDATE "WhatsAppBroadcastSchedule" SET status='RUNNING',"leaseId"=${leaseId},"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '3 minutes',"startedAt"=COALESCE("startedAt",CURRENT_TIMESTAMP),"updatedAt"=CURRENT_TIMESTAMP WHERE id=${row.id} AND status IN ('SCHEDULED','RUNNING') AND "scheduledAt"<=${now} AND ("leaseUntil" IS NULL OR "leaseUntil"<CURRENT_TIMESTAMP) RETURNING *`);if(!job)continue;
  const scope={organizationId:job.organizationId,userId:job.userId,batchId:job.id};
  const finish=(status:string,error:string|null=null)=>prisma.$executeRaw(Prisma.sql`UPDATE "WhatsAppBroadcastSchedule" SET status=${status},"lastError"=${error},"leaseId"=NULL,"leaseUntil"=NULL,"completedAt"=CASE WHEN ${status} IN ('COMPLETED','PARTIAL') THEN CURRENT_TIMESTAMP ELSE "completedAt" END,"updatedAt"=CURRENT_TIMESTAMP WHERE id=${job.id} AND status='RUNNING' AND "leaseId"=${leaseId}`);
  try{
   const uncertain=await prisma.whatsAppBatchDelivery.findMany({where:{...scope,status:{in:["SENDING","UNKNOWN"]}},select:{id:true}});
   if(uncertain.some(d=>!job.acknowledgedIds.includes(d.id))){await finish("PAUSED","Há envio sem confirmação. Confira a conversa e use Continuar só pendentes; esse destinatário não será reenviado.");continue;}
   const pending=await prisma.whatsAppBatchDelivery.findMany({where:{...scope,status:"PENDING"},orderBy:[{createdAt:"asc"},{id:"asc"}],take:100});
   let paused=false;
   for(const delivery of pending){if(Date.now()>=deadline)break;
    const actor=await actorFor(job);if(!actor){await finish("PAUSED","O autor não possui mais permissão de envio. Cancele e crie um novo agendamento com um operador autorizado.");paused=true;break;}
    const lease=await prisma.$executeRaw(Prisma.sql`UPDATE "WhatsAppBroadcastSchedule" SET "leaseUntil"=CURRENT_TIMESTAMP+INTERVAL '3 minutes' WHERE id=${job.id} AND status='RUNNING' AND "leaseId"=${leaseId}`);if(!lease){paused=true;break;}
    const response=await deliverBatchMessage(delivery.id,actor,{scheduleId:job.id,leaseId}),result=await response.json();
    if(!response.ok||["UNKNOWN","SENDING"].includes(result.status)){await finish("PAUSED",typeof result.error==="string"?result.error:"Envio sem confirmação. Confira a conversa antes de continuar com os pendentes.");paused=true;break;}
   }
   if(paused)continue;
   const counts=await prisma.whatsAppBatchDelivery.groupBy({by:["status"],where:scope,_count:{_all:true}});
   if(counts.some(c=>c.status==="PENDING"&&c._count._all))await finish("RUNNING");
   else await finish(counts.some(c=>["UNKNOWN","SENDING","CANCELLED"].includes(c.status)&&c._count._all)?"PARTIAL":"COMPLETED");
  }catch{await finish("PAUSED","Não foi possível concluir o disparo. Confira os resultados antes de continuar com os pendentes.").catch(()=>undefined);}
 }
}
