import {Prisma} from "@/generated/prisma/client";
import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {whatsappSendAccess,WhatsAppSendError} from "@/modules/whatsapp/outbound-access";
import {accountMessageWhere} from "@/modules/whatsapp/account-scope";
import {parseWhatsappChannelAddress} from "@/modules/whatsapp/core";
import {object} from "@/modules/whatsapp/uazapi";
import {sendUazapiText,sendUazapiMedia} from "@/modules/whatsapp/uazapi-server";
import {createAdminClient} from "@/lib/supabase/admin";
import {WHATSAPP_FILES_BUCKET} from "@/modules/whatsapp/outbound-files";
import {mediaKind} from "@/modules/whatsapp/media";
import {GET as downloadAttachment} from "../attachments/[attachmentId]/route";
export const runtime="nodejs";export const maxDuration=60;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 try{
  const {id}=await context.params,source=await whatsappSendAccess(id),input=await request.json();
  if(typeof input.destinationId!=="string"||input.destinationId.length>100||typeof input.messageId!=="string"||input.messageId.length>100||!/^[-a-f0-9]{36}$/.test(input.requestId))throw new WhatsAppSendError("Escolha uma mensagem e um destino válido.");
  const target=await whatsappSendAccess(input.destinationId);if(target.member.userId!==source.member.userId||target.account.recipient!==source.account.recipient)throw new WhatsAppSendError("Destino inválido.");
  const message=await prisma.serviceMessage.findFirst({where:{id:input.messageId,direction:{not:"INTERNAL"},...accountMessageWhere(source.account.connection),ticket:{...source.account.where,senderEmail:source.ticket.senderEmail,isSpam:false,mergedIntoId:null}},include:{attachments:true}});
  if(!message||object(message.providerMetadata).deletedAt)throw new WhatsAppSendError("Mensagem indisponível para encaminhar.",404);
  const claimId="wa-forward-"+input.requestId;
  const previous=await prisma.serviceTicketHistory.findFirst({where:{id:claimId,ticket:{organizationId:source.member.organizationId}}});
  if(previous){if(object(previous.metadata).state==="SENT")return NextResponse.json({ok:true,alreadySent:true});throw new WhatsAppSendError("Encaminhamento em processamento ou sem confirmação. Confira o destino antes de repetir.",409);}
  const attachment=message.attachments[0];let storagePath:string|undefined,fileUrl:string|undefined,mimeType=attachment?.mimeType||"application/octet-stream";
  if(attachment){
   const file=await downloadAttachment(new Request(new URL("?preview=1",request.url)),{params:Promise.resolve({id:message.ticketId,attachmentId:attachment.id})});
   // Documents have no inline preview; their normal download is still authenticated.
   const response=file.status===415?await downloadAttachment(new Request(new URL("?download=1",request.url)),{params:Promise.resolve({id:message.ticketId,attachmentId:attachment.id})}):file;
   if(!response.ok)throw new WhatsAppSendError("Não foi possível ler o anexo original.");
   const blob=await response.blob();if(blob.size>25000000)throw new WhatsAppSendError("Anexo maior que 25 MB.");mimeType=blob.type||mimeType;
   const admin=createAdminClient();if(!admin)throw new WhatsAppSendError("Armazenamento indisponível.",503);
   storagePath=`${source.member.organizationId}/${target.ticket.id}/forward/${input.requestId}/${attachment.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
   const configured=await admin.storage.getBucket(WHATSAPP_FILES_BUCKET);
   if(configured.data?.public)throw new WhatsAppSendError("O armazenamento precisa ser privado.",503);
   if(!configured.data){if(configured.error&&!/not found|does not exist|404/i.test(configured.error.message))throw new WhatsAppSendError("Não foi possível conferir o armazenamento privado.",503);const created=await admin.storage.createBucket(WHATSAPP_FILES_BUCKET,{public:false,fileSizeLimit:25000000});if(created.error&&!/already exists|duplicate/i.test(created.error.message))throw new WhatsAppSendError("Não foi possível preparar o armazenamento privado.",503);}
   const bucket=admin.storage.from(WHATSAPP_FILES_BUCKET),uploaded=await bucket.upload(storagePath,blob,{contentType:mimeType,upsert:true});if(uploaded.error)throw new WhatsAppSendError("Não foi possível preparar o anexo.",503);
   const signed=await bucket.createSignedUrl(storagePath,300);if(signed.error||!signed.data)throw new WhatsAppSendError("Não foi possível preparar o anexo.",503);fileUrl=signed.data.signedUrl;
  }
  // Persist intent before calling the provider. An uncertain response is never retried automatically.
  try{await prisma.serviceTicketHistory.create({data:{id:claimId,ticketId:target.ticket.id,userId:source.member.userId,type:"WHATSAPP_FORWARDED",message:"Encaminhamento solicitado.",metadata:{state:"SENDING",sourceMessageId:message.id,accountRecipient:target.account.recipient}}});}catch{throw new WhatsAppSendError("Este encaminhamento já foi iniciado. Confira a conversa de destino.",409);}
  const to=parseWhatsappChannelAddress(target.ticket.senderEmail).externalId,common={organizationId:source.member.organizationId,accountRecipient:target.account.recipient!,to,forward:true};
  const kind=attachment?mediaKind(mimeType,attachment.name,message.textBody||""):null;
  const sent=attachment&&fileUrl?await sendUazapiMedia({...common,type:kind==="image"||kind==="video"||kind==="audio"?kind:"document",file:fileUrl,name:attachment.name,mimeType,caption:/^\[.*Message\]$/.test(message.textBody||"")?"":message.textBody||"",trackingId:claimId}):await sendUazapiText({...common,body:message.textBody||"Mensagem encaminhada"});
  await prisma.$transaction(async tx=>{
   await tx.serviceMessage.create({data:{ticketId:target.ticket.id,externalMessageId:sent.messageId,direction:"OUTBOUND",fromName:source.member.user.name||source.member.user.email,fromEmail:source.member.user.email,toEmails:[target.ticket.senderEmail],textBody:message.textBody,receivedAt:new Date(),deliveryStatus:"accepted",providerMetadata:{provider:"UAZAPI",accountPhone:sent.accountPhone,instanceId:sent.instanceId,connectionId:sent.connectionId,forwardedFromMessageId:message.id},...(attachment&&storagePath?{attachments:{create:{name:attachment.name,mimeType,storagePath,size:attachment.size}}}:{})}});
   await tx.serviceTicket.update({where:{id:target.ticket.id},data:{lastMessageAt:new Date(),updatedAt:new Date(),snippet:message.textBody?.slice(0,220)||"Anexo encaminhado",}});
   await tx.$executeRaw(Prisma.sql`UPDATE "ServiceTicket" SET "firstResponseAt"=COALESCE("firstResponseAt",CURRENT_TIMESTAMP) WHERE id=${target.ticket.id}`);
   await tx.serviceTicketHistory.update({where:{id:claimId},data:{metadata:{state:"SENT",sourceMessageId:message.id,externalMessageId:sent.messageId},message:"Mensagem encaminhada pelo operador."}});
  });return NextResponse.json({ok:true});
 }catch(error){return NextResponse.json({error:error instanceof WhatsAppSendError?error.message:"Encaminhamento não confirmado. Confira o destino antes de repetir."},{status:error instanceof WhatsAppSendError?error.status:502});}
}
