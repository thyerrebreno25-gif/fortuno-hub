import "server-only";
import {NextResponse} from "next/server";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {whatsappSendAccess,WhatsAppSendError} from "./outbound-access";
import {accountMessageWhere} from "./account-scope";
import {changeUazapiMessage} from "./uazapi-server";
import {object,text} from "./uazapi";
import {messageEditProblem} from "./message-edit";
import {signedWhatsappText} from "./operator-signature";
export async function mutateWhatsAppMessage(request:Request,id:string,messageId:string,action:"edit"|"delete"){
 try{
  const {member,ticket,account}=await whatsappSendAccess(id);
  if(!messageId||messageId.length>100)throw new WhatsAppSendError("Mensagem inválida.");
  const message=await prisma.serviceMessage.findFirst({where:{id:messageId,direction:"OUTBOUND",...accountMessageWhere(account.connection),ticket:{...account.where,senderEmail:ticket.senderEmail,isSpam:false,mergedIntoId:null}},select:{id:true,ticketId:true,externalMessageId:true,providerMetadata:true,textBody:true,fromName:true,receivedAt:true,deliveryStatus:true,attachments:{select:{id:true}}}});
  if(!message)throw new WhatsAppSendError("Mensagem enviada não encontrada nesta conversa.",404);
  const meta=object(message.providerMetadata);
  if(meta.deletedAt)throw new WhatsAppSendError("Esta mensagem já foi excluída.",409);
  if(meta.automation)throw new WhatsAppSendError("Não é possível alterar esta mensagem automática.");
  const external=text(meta.messageId)||message.externalMessageId?.split(":").at(-1);
  if(!external||!message.externalMessageId?.startsWith(`uazapi:${account.connection!.phone}:`))throw new WhatsAppSendError("Mensagem indisponível na conta atual.");
  let content="";
  if(action==="edit"){
   const body=await request.json().catch(()=>null);content=typeof body?.text==="string"?body.text.trim():"";
   if(!content||content.length>10000||message.attachments.length)throw new WhatsAppSendError("Informe um texto de até 10.000 caracteres. Anexos não podem ser editados.");
   const problem=messageEditProblem(message);if(problem)throw new WhatsAppSendError(problem);
   if(typeof body?.originalText==="string"&&body.originalText!==(message.textBody||""))throw new WhatsAppSendError("Esta mensagem já foi alterada. Feche o editor e abra novamente para carregar o texto atualizado.",409);
   if(content===(message.textBody||"").trim())return NextResponse.json({messageId:message.id,textBody:message.textBody,editedAt:meta.editedAt||undefined});
  }
  try{await changeUazapiMessage({organizationId:member.organizationId,accountRecipient:account.recipient!,messageId:external,action,...(action==="edit"?{body:signedWhatsappText(message.fromName||member.user.name,content)}:{})});}catch{throw new WhatsAppSendError("O WhatsApp não confirmou a alteração. Confira a mensagem e o prazo permitido antes de repetir.",502);}
  const now=new Date().toISOString();
  await prisma.$transaction(async tx=>{
   await tx.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" SET "providerMetadata"=COALESCE("providerMetadata",'{}'::jsonb)||${JSON.stringify(action==="delete"?{deletedAt:now,deletedBy:member.userId}:{editedAt:now,editedBy:member.userId})}::jsonb WHERE id=${message.id}`);
   if(action==="edit")await tx.serviceMessage.update({where:{id:message.id},data:{textBody:content}});
   await tx.serviceTicketHistory.create({data:{ticketId:ticket.id,userId:member.userId,type:action==="edit"?"WHATSAPP_MESSAGE_EDITED":"WHATSAPP_MESSAGE_DELETED",message:action==="edit"?"Mensagem editada no WhatsApp.":"Mensagem excluída no WhatsApp; conteúdo preservado internamente.",metadata:{messageId:message.id,previousText:message.textBody,...(action==="edit"?{text:content}:{})}}});
   await tx.serviceTicket.update({where:{id:ticket.id},data:{updatedAt:new Date()}});
   if(action==="edit"){const latest=await tx.serviceMessage.findFirst({where:{ticketId:ticket.id,direction:{not:"INTERNAL"}},orderBy:[{receivedAt:"desc"},{id:"desc"}],select:{id:true}});if(latest?.id===message.id)await tx.serviceTicket.update({where:{id:ticket.id},data:{snippet:content.slice(0,220)}});}
  });
  return NextResponse.json({messageId:message.id,...(action==="delete"?{deletedAt:now}:{editedAt:now,textBody:content})});
 }catch(error){return NextResponse.json({error:error instanceof WhatsAppSendError?error.message:"Não foi possível registrar a alteração. Confira a mensagem no WhatsApp antes de repetir."},{status:error instanceof WhatsAppSendError?error.status:502});}
}
