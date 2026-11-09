import "server-only";
import {Prisma,type ServiceTicket} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {currentWhatsAppAccount} from "./account-scope";
import {chatLock} from "./merge";
export class ReopenWhatsAppError extends Error{constructor(message:string,public status=409){super(message);}}
type ClosedCall=Pick<ServiceTicket,"id"|"organizationId"|"status"|"source"|"senderEmail"|"senderName"|"subject"|"recipientEmail"|"clientId"|"routingArea"|"routingSquad"|"priority">;
export async function reopenWhatsAppCall(ticket:ClosedCall,userId:string){
 const account=await currentWhatsAppAccount(ticket.organizationId),connection=account.connection;
 if(!connection||!account.recipient||ticket.recipientEmail!==account.recipient)throw new ReopenWhatsAppError("A conversa pertence a outro número ou a conexão está indisponível.");
 if(ticket.source!=="WHATSAPP_API"||!["RESOLVED","IN_PROGRESS","NEW","WAITING_CUSTOMER","WAITING_INTERNAL"].includes(ticket.status))throw new ReopenWhatsAppError("Não é possível abrir este chamado.");
 return prisma.$transaction(async tx=>{
   const bound=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT id FROM "WhatsAppConnection" WHERE id=${connection.id} AND "organizationId"=${ticket.organizationId} AND phone=${connection.phone} AND status='CONNECTED' FOR SHARE`);
   if(!bound.length)throw new ReopenWhatsAppError("O número conectado mudou. Atualize a página.");
   // Same chat lock as the webhook: simultaneous reopen clicks or a new inbound reuse one active call.
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(connection.id,ticket.senderEmail)}))`;
   const active=await tx.serviceTicket.findFirst({where:{...account.where,senderEmail:ticket.senderEmail,mergedIntoId:null,isSpam:false,status:{notIn:["RESOLVED","SPAM"]}},orderBy:{lastMessageAt:"desc"},select:{id:true}});
   if(active)return active.id;
   const closed=await tx.serviceTicket.findFirst({where:{id:ticket.id,...account.where,status:"RESOLVED",mergedIntoId:null,isSpam:false},select:{id:true}});
   if(!closed)throw new ReopenWhatsAppError("O atendimento foi alterado. Atualize a conversa.");
   const now=new Date();
   const next=await tx.serviceTicket.create({data:{organizationId:ticket.organizationId,source:"WHATSAPP_API",senderEmail:ticket.senderEmail,senderName:ticket.senderName,subject:ticket.subject,recipientEmail:account.recipient,clientId:ticket.clientId,routingArea:ticket.routingArea,routingSquad:ticket.routingSquad,priority:ticket.priority,externalThreadId:`reopen:${crypto.randomUUID()}`,status:"IN_PROGRESS",assignedToId:userId,assignedAt:now,receivedAt:now,lastMessageAt:now,snippet:"Chamado aberto pela equipe.",routingReason:"Atendimento aberto manualmente após a finalização."},select:{id:true}});
   await tx.serviceTicketHistory.create({data:{ticketId:next.id,userId,type:"WHATSAPP_REOPENED",message:"Novo atendimento aberto a partir de conversa finalizada. Histórico anterior preservado.",metadata:{previousTicketId:ticket.id}}});
   return next.id;
 });
}
