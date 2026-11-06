import "server-only";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentWhatsAppAccount } from "./account-scope";
import { getWhatsappTicket, resolveWhatsappTicketId } from "./server";
import { outgoingContext } from "./outgoing-context";
import { object } from "./uazapi";
import { sendUazapiText, whatsappConnection } from "./uazapi-server";
import { signedWhatsappText } from "./operator-signature";
import { chatLock } from "./merge";
type Actor={organizationId:string;userId:string;user:{name:string|null;email:string}};
export async function deliverBatchMessage(deliveryId:string,actor:Actor) {
  const where={id:deliveryId,organizationId:actor.organizationId,userId:actor.userId};
  const delivery=await prisma.whatsAppBatchDelivery.findFirst({where});
  if(!delivery)return NextResponse.json({error:"Envio não encontrado."},{status:404});
  const account=await currentWhatsAppAccount(actor.organizationId);
  if(account.recipient!==delivery.accountRecipient)return NextResponse.json({error:"A conta do WhatsApp mudou. Prepare um novo lote para esta conexão."},{status:409});
  // A claim is permanent: lost responses or timeouts must never trigger an automatic second send.
  if(delivery.status!=="PENDING")return NextResponse.json({id:delivery.id,status:delivery.status,error:delivery.error});
  const ticket=await getWhatsappTicket(delivery.ticketId,actor.organizationId,{});
  if(!ticket||["RESOLVED","SPAM"].includes(ticket.status)||ticket.assignedToId!==actor.userId) {
    await prisma.whatsAppBatchDelivery.updateMany({where:{...where,status:"PENDING"},data:{status:"CANCELLED",error:"Conversa indisponível ou atribuída a outro colaborador."}});
    return NextResponse.json({id:delivery.id,status:"CANCELLED",error:"Conversa indisponível ou atribuída a outro colaborador."});
  }
  const claim=await prisma.whatsAppBatchDelivery.updateMany({where:{...where,status:"PENDING"},data:{status:"SENDING"}});
  if(!claim.count)return NextResponse.json({id:delivery.id,status:"SENDING"});
  let externalMessageId:string|null=null;
  try {
    const latestInbound=[...ticket.messages].reverse().find(m=>m.direction==="INBOUND");
    const connection=await whatsappConnection(actor.organizationId);
    const destination=outgoingContext(ticket.recipientEmail,ticket.senderEmail,connection,object(latestInbound?.providerMetadata));
    const sent=await sendUazapiText({organizationId:actor.organizationId,accountRecipient:delivery.accountRecipient,body:signedWhatsappText(actor.user.name,delivery.body),...destination});
    externalMessageId=sent.messageId;
    const now=new Date();
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(sent.connectionId,ticket.senderEmail)}))`;
      const id=await resolveWhatsappTicketId(ticket.id,actor.organizationId,tx);
      const active=await tx.serviceTicket.findFirst({where:{id,organizationId:actor.organizationId}});
      const author={fromName:actor.user.name||actor.user.email,fromEmail:actor.user.email,textBody:delivery.body};
      const metadata={provider:"UAZAPI",connectionId:sent.connectionId,instanceId:sent.instanceId,accountPhone:sent.accountPhone,batchId:delivery.batchId};
      // The webhook may have persisted the same outgoing message before the send response arrived.
      await tx.serviceMessage.upsert({where:{ticketId_externalMessageId:{ticketId:id,externalMessageId:sent.messageId}},create:{ticketId:id,externalMessageId:sent.messageId,deliveryStatus:"accepted",statusUpdatedAt:now,providerMetadata:metadata,direction:"OUTBOUND",...author,toEmails:[ticket.senderEmail],receivedAt:now},update:{...author,providerMetadata:metadata}});
      await tx.serviceTicket.update({where:{id,mergedIntoId:null},data:{assignedToId:active?.assignedToId||actor.userId,assignedAt:active?.assignedAt||now,firstResponseAt:active?.firstResponseAt||now,lastMessageAt:now,snippet:delivery.body.slice(0,220),status:active?.status==="RESOLVED"?"RESOLVED":"IN_PROGRESS"}});
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
