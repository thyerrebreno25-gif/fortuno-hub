import "server-only";
import {BROADCAST_SENDER_NAME} from "./broadcast-policy";
import {guardScheduledDelivery,type BroadcastExecution} from "./broadcast-schedule-guard";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import { currentWhatsAppAccount } from "./account-scope";
import { getWhatsappTicket, resolveWhatsappTicketId } from "./server";
import { outgoingContext } from "./outgoing-context";
import { object } from "./uazapi";
import { sendUazapiText, whatsappConnection } from "./uazapi-server";
import { signedWhatsappText } from "./operator-signature";
import { chatLock } from "./merge";
type Actor={organizationId:string;userId:string;user:{name:string|null;email:string}};
export async function deliverBatchMessage(deliveryId:string,actor:Actor,execution?:BroadcastExecution) {
  const where={id:deliveryId,organizationId:actor.organizationId,userId:actor.userId};
  const delivery=await prisma.whatsAppBatchDelivery.findFirst({where});
  if(!delivery)return NextResponse.json({error:"Envio não encontrado."},{status:404});
  const account=await currentWhatsAppAccount(actor.organizationId);
  if(account.recipient!==delivery.accountRecipient)return NextResponse.json({error:"A conta do WhatsApp mudou. Prepare um novo lote para esta conexão."},{status:409});
  // A claim is permanent: lost responses or timeouts must never trigger an automatic second send.
  if(delivery.status!=="PENDING")return NextResponse.json({id:delivery.id,status:delivery.status,error:delivery.error});
  const ticket=await getWhatsappTicket(delivery.ticketId,actor.organizationId,{});
  if(!ticket||!ticket.clientId||ticket.status==="SPAM"||ticket.isSpam||ticket.recipientEmail!==delivery.accountRecipient) {
    await prisma.whatsAppBatchDelivery.updateMany({where:{...where,status:"PENDING"},data:{status:"CANCELLED",error:"Conversa indisponível ou fora desta conexão."}});
    return NextResponse.json({id:delivery.id,status:"CANCELLED",error:"Conversa indisponível ou fora desta conexão."});
  }
  const claim=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`batch-client:${actor.organizationId}:${actor.userId}:${delivery.batchId}:${ticket.clientId}`}))`;
    const guard=await guardScheduledDelivery(tx,delivery,actor,ticket,execution);
    if(guard?.blocked)return {count:0,blocked:guard.blocked};
    if(guard?.cancelled){await tx.whatsAppBatchDelivery.updateMany({where:{...where,status:"PENDING"},data:{status:"CANCELLED",error:guard.cancelled}});return {count:0,cancelled:true,error:guard.cancelled};}
    // Protect previously prepared lots too: two historical tickets/groups for one client are one recipient.
    const previous=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`SELECT d.id FROM "WhatsAppBatchDelivery" d JOIN "ServiceTicket" t ON t.id=d."ticketId" WHERE d."organizationId"=${actor.organizationId} AND d."userId"=${actor.userId} AND d."batchId"=${delivery.batchId} AND d."accountRecipient"=${delivery.accountRecipient} AND d.id<>${delivery.id} AND d.status IN ('SENDING','SENT','UNKNOWN') AND t."organizationId"=${actor.organizationId} AND t."clientId"=${ticket.clientId} LIMIT 1`);
    if(previous.length){await tx.whatsAppBatchDelivery.updateMany({where:{...where,status:"PENDING"},data:{status:"CANCELLED",error:"Este cliente já possui um envio iniciado neste lote."}});return {count:0,cancelled:true};}
    return tx.whatsAppBatchDelivery.updateMany({where:{...where,status:"PENDING"},data:{status:"SENDING"}});
  });
  if("blocked" in claim)return NextResponse.json({error:claim.blocked},{status:409});
  if("cancelled" in claim)return NextResponse.json({id:delivery.id,status:"CANCELLED",error:("error" in claim?claim.error:null)||"Este cliente já possui um envio iniciado neste lote."});
  if(!claim.count)return NextResponse.json({id:delivery.id,status:"SENDING"});
  let externalMessageId:string|null=null;
  try {
    const latestInbound=[...ticket.messages].reverse().find(m=>m.direction==="INBOUND");
    const connection=await whatsappConnection(actor.organizationId);
    const destination=outgoingContext(ticket.recipientEmail,ticket.senderEmail,connection,object(latestInbound?.providerMetadata));
    const sent=await sendUazapiText({organizationId:actor.organizationId,accountRecipient:delivery.accountRecipient,body:signedWhatsappText(BROADCAST_SENDER_NAME,delivery.body),...destination});
    externalMessageId=sent.messageId;
    const now=new Date();
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(sent.connectionId,ticket.senderEmail)}))`;
      const id=await resolveWhatsappTicketId(ticket.id,actor.organizationId,tx);
      const author={fromName:BROADCAST_SENDER_NAME,fromEmail:actor.user.email,textBody:delivery.body};
      const metadata={provider:"UAZAPI",connectionId:sent.connectionId,instanceId:sent.instanceId,accountPhone:sent.accountPhone,batchId:delivery.batchId,broadcast:true,userId:actor.userId};
      // The webhook may have persisted the same outgoing message before the send response arrived.
      await tx.serviceMessage.upsert({where:{ticketId_externalMessageId:{ticketId:id,externalMessageId:sent.messageId}},create:{ticketId:id,externalMessageId:sent.messageId,deliveryStatus:"accepted",statusUpdatedAt:now,providerMetadata:metadata,direction:"OUTBOUND",...author,toEmails:[ticket.senderEmail],receivedAt:now},update:{...author,providerMetadata:metadata}});
      // Batch communication never claims a queue item or changes another operator's workflow/SLA.
      await tx.serviceTicket.update({where:{id,mergedIntoId:null},data:{lastMessageAt:now,snippet:delivery.body.slice(0,220)}});
      await tx.serviceTicketHistory.create({data:{ticketId:id,userId:actor.userId,type:"WHATSAPP_REPLIED",message:"Mensagem padrão enviada em lote.",metadata:{batchId:delivery.batchId,externalMessageId:sent.messageId}}});
      await tx.whatsAppBatchDelivery.update({where:{id:delivery.id},data:{status:"SENT",externalMessageId:sent.messageId,error:null}});
    });
    return NextResponse.json({id:delivery.id,status:"SENT"});
  }catch{
    const error=externalMessageId?"A Uazapi aceitou o envio, mas o registro local não foi confirmado. Confira a conversa antes de reenviar.":"O provedor não confirmou o envio. Confira a conversa antes de reenviar.";
    await prisma.whatsAppBatchDelivery.updateMany({where:{...where,status:"SENDING"},data:{status:"UNKNOWN",error,externalMessageId}});
    return NextResponse.json({id:delivery.id,status:"UNKNOWN",error});
  }
}
