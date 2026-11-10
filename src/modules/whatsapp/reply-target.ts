import "server-only";
import {prisma} from "@/lib/prisma";
import {accountMessageWhere,currentWhatsAppAccount} from "./account-scope";
import {object,text} from "./uazapi";
import type {QuotedMessage} from "./quote-core";
export class ReplyTargetError extends Error{constructor(message:string,public status=400){super(message);}}
type Current={id:string;organizationId:string;senderEmail:string;recipientEmail:string|null;createdAt?:Date};
export async function findReplyTarget(current:Current,messageId:unknown,knownAccount?:Awaited<ReturnType<typeof currentWhatsAppAccount>>){
 if(typeof messageId!=="string"||!messageId||messageId.length>100)throw new ReplyTargetError("Escolha uma mensagem válida para responder.");
 const account=knownAccount||await currentWhatsAppAccount(current.organizationId);
 if(!account.recipient||current.recipientEmail!==account.recipient)throw new ReplyTargetError("A conversa não pertence ao WhatsApp conectado.",404);
 const message=await prisma.serviceMessage.findFirst({where:{id:messageId,direction:{not:"INTERNAL"},...accountMessageWhere(account.connection),ticket:{...account.where,senderEmail:current.senderEmail,isSpam:false,mergedIntoId:null,OR:[{id:current.id},{status:"RESOLVED",createdAt:{lte:current.createdAt||new Date()}}]}},select:{id:true,ticketId:true,externalMessageId:true,providerMetadata:true,fromName:true,textBody:true,receivedAt:true,attachments:{select:{id:true,name:true,mimeType:true,size:true},take:10,orderBy:{createdAt:"asc"}}}});
 if(!message)throw new ReplyTargetError("A mensagem original não foi encontrada nesta conversa.",404);
 const providerId=text(object(message.providerMetadata).messageId,200)||message.externalMessageId?.split(":").at(-1)||"";
 const quote:QuotedMessage={id:message.id,sourceTicketId:message.ticketId,fromName:message.fromName,textBody:message.textBody?.slice(0,1000)||null,receivedAt:message.receivedAt.toISOString(),attachmentName:message.attachments[0]?.name||null};
 return {quote,providerId,message:{id:message.id,sourceTicketId:message.ticketId,fromName:message.fromName,textBody:message.textBody,receivedAt:message.receivedAt.toISOString(),attachments:message.attachments}};
}
