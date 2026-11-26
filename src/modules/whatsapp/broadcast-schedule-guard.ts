import "server-only";
import {Prisma} from "@/generated/prisma/client";
import type {BroadcastJob,ScheduledTarget} from "./broadcast-schedule-server";
import {batchAddress} from "./batch-recipients";
export type BroadcastExecution={scheduleId:string;leaseId:string};
export async function scheduledBatchExists(tx:Prisma.TransactionClient,organizationId:string,batchId:string){const rows=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "WhatsAppBroadcastSchedule" WHERE id=${batchId} AND "organizationId"=${organizationId}`);return rows.length>0;}
/** This row lock serializes recipient claims with cancellation and other workers. */
export async function guardScheduledDelivery(tx:Prisma.TransactionClient,delivery:{batchId:string;ticketId:string;body:string;accountRecipient:string},actor:{organizationId:string;userId:string},ticket:{id:string;clientId:string|null;senderEmail:string},execution?:BroadcastExecution):Promise<{blocked?:string;cancelled?:string}|null>{
 const [job]=await tx.$queryRaw<Array<Omit<BroadcastJob,"recipients">&{target:ScheduledTarget|null}>>(Prisma.sql`SELECT id,"userId","accountRecipient",body,status,"leaseId","leaseUntil","scheduledAt",(SELECT target FROM jsonb_array_elements(recipients) target WHERE target->>'ticketId'=${delivery.ticketId} LIMIT 1) AS target FROM "WhatsAppBroadcastSchedule" WHERE id=${delivery.batchId} AND "organizationId"=${actor.organizationId} FOR UPDATE`);
 if(!job)return execution?{blocked:"Agendamento indisponível."}:null;
 if(!execution||job.id!==execution.scheduleId||job.userId!==actor.userId||job.leaseId!==execution.leaseId||job.status!=="RUNNING"||+job.scheduledAt>Date.now()||!job.leaseUntil||+job.leaseUntil<=Date.now())return {blocked:"Este envio pertence a um agendamento. Consulte os disparos agendados."};
 const target=job.target;
 if(!target||target.clientId!==ticket.clientId||target.address!==batchAddress(ticket.senderEmail)||job.body!==delivery.body||job.accountRecipient!==delivery.accountRecipient)return {cancelled:"O vínculo ou o destino mudou desde o agendamento. Destinatário ignorado."};
 const [valid]=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT t.id FROM "ServiceTicket" t JOIN "Client" c ON c.id=t."clientId" AND c."organizationId"=t."organizationId" WHERE t.id=${ticket.id} AND t."organizationId"=${actor.organizationId} AND t."recipientEmail"=${job.accountRecipient} AND t."clientId"=${target.clientId} AND c.active=true AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND t.status::text<>'SPAM'`);
 return valid?null:{cancelled:"O cliente ou a conversa não está mais disponível para este agendamento."};
}
