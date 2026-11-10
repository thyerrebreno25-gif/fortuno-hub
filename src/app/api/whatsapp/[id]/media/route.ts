import {findReplyTarget,ReplyTargetError} from "@/modules/whatsapp/reply-target";
import {NextResponse} from "next/server";
import {z} from "zod";
import {prisma} from "@/lib/prisma";
import {createAdminClient} from "@/lib/supabase/admin";
import {whatsappSendAccess,WhatsAppSendError} from "@/modules/whatsapp/outbound-access";
import {WhatsAppFileError,WHATSAPP_FILES_BUCKET,WHATSAPP_FILE_LIMIT,whatsappFileInfo,validFileContent} from "@/modules/whatsapp/outbound-files";
import {sendUazapiMedia} from "@/modules/whatsapp/uazapi-server";
import {parseWhatsappChannelAddress} from "@/modules/whatsapp/core";
import {signedWhatsappText} from "@/modules/whatsapp/operator-signature";
export const runtime="nodejs";
export const maxDuration=60;
const inputSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("prepare"),name:z.string().min(1).max(200),size:z.number().int().positive().max(WHATSAPP_FILE_LIMIT)}),
  z.object({action:z.literal("send"),uploadId:z.string().min(1).max(100),caption:z.string().max(5000).default(""),asDocument:z.boolean().default(false),replyToMessageId:z.string().min(1).max(100).nullish()}),
]);
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params;
    const access=await whatsappSendAccess(id),{member,ticket,account}=access;
    const input=inputSchema.parse(await request.json()),admin=createAdminClient();
    if(!admin)throw new WhatsAppSendError("O armazenamento de anexos não está configurado.",503);
    const storage=admin.storage.from(WHATSAPP_FILES_BUCKET);
    if(input.action==="prepare"){
      const info=whatsappFileInfo(input.name,input.size);
      const recent=await prisma.serviceTicketHistory.count({where:{userId:member.userId,type:"WHATSAPP_MEDIA_UPLOAD",createdAt:{gte:new Date(Date.now()-60*60*1000)},ticket:{organizationId:member.organizationId}}});
      if(recent>=100)throw new WhatsAppSendError("Limite de preparação de anexos atingido. Tente mais tarde.",429);
      const {data:bucket,error:bucketError}=await admin.storage.getBucket(WHATSAPP_FILES_BUCKET);
      if(!bucket){
        if(bucketError&&!/not found|does not exist|404/i.test(bucketError.message))throw new WhatsAppSendError("Não foi possível consultar o armazenamento privado.",503);
        const {error}=await admin.storage.createBucket(WHATSAPP_FILES_BUCKET,{public:false,fileSizeLimit:WHATSAPP_FILE_LIMIT});
        if(error&&!/already exists|duplicate/i.test(error.message))throw new WhatsAppSendError("Não foi possível preparar o armazenamento privado.",503);
      }else if(bucket.public)throw new WhatsAppSendError("O armazenamento de anexos precisa ser privado.",503);
      const path=`${member.organizationId}/${ticket.id}/${crypto.randomUUID()}/${info.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      const {data:upload,error}=await storage.createSignedUploadUrl(path);
      if(error||!upload)throw new WhatsAppSendError("Não foi possível preparar o anexo.",503);
      const draft=await prisma.serviceTicketHistory.create({data:{ticketId:ticket.id,userId:member.userId,type:"WHATSAPP_MEDIA_UPLOAD",message:"Anexo preparado para revisão e envio.",metadata:{state:"READY",path,name:info.name,size:input.size,mimeType:info.mimeType,accountRecipient:account.recipient}}});
      return NextResponse.json({uploadId:draft.id,path,token:upload.token,bucket:WHATSAPP_FILES_BUCKET,mimeType:info.mimeType});
    }
    const draft=await prisma.serviceTicketHistory.findFirst({where:{id:input.uploadId,ticketId:ticket.id,userId:member.userId,type:"WHATSAPP_MEDIA_UPLOAD"}});
    const parsed=z.object({state:z.string(),path:z.string(),name:z.string(),size:z.number(),mimeType:z.string(),accountRecipient:z.string(),messageId:z.string().optional(),externalMessageId:z.string().optional()}).safeParse(draft?.metadata);
    if(!draft||!parsed.success)throw new WhatsAppSendError("Anexo não encontrado.",404);
    const meta=parsed.data;
    if(meta.accountRecipient!==account.recipient)throw new WhatsAppSendError("Anexo não encontrado nesta conta e conversa.",404);
    if(meta.state==="SENT")return NextResponse.json({ok:true,messageId:meta.messageId,alreadySent:true});
    if(meta.state!=="READY")throw new WhatsAppSendError("Envio em processamento ou sem confirmação. Confira a conversa antes de repetir.",409);
    if(Date.now()-draft.createdAt.getTime()>60*60*1000)throw new WhatsAppSendError("A preparação do anexo expirou. Selecione o arquivo novamente.",410);
    const replyTarget=input.replyToMessageId?await findReplyTarget({...ticket,organizationId:member.organizationId},input.replyToMessageId,account):null;
    if(replyTarget&&!replyTarget.providerId)throw new WhatsAppSendError("Mensagem original indisponível para responder.");
    const info=whatsappFileInfo(String(meta.name),Number(meta.size)),path=String(meta.path);
    if(!path.startsWith(`${member.organizationId}/${ticket.id}/`))throw new WhatsAppSendError("Anexo inválido.");
    const file=await storage.download(path);
    if(file.error||!file.data||file.data.size!==Number(meta.size)||file.data.size>WHATSAPP_FILE_LIMIT)throw new WhatsAppSendError("O upload está incompleto. Selecione o arquivo novamente.");
    if(!validFileContent(info.name,new Uint8Array(await file.data.arrayBuffer())))throw new WhatsAppSendError("O conteúdo do arquivo não corresponde ao formato informado.");
    const signed=await storage.createSignedUrl(path,300);
    if(signed.error||!signed.data)throw new WhatsAppSendError("Não foi possível liberar o arquivo para envio.",503);
    // Claim once before contacting the provider. A lost response must never duplicate a media message.
    const claimed=await prisma.serviceTicketHistory.updateMany({where:{id:draft.id,metadata:{path:["state"],equals:"READY"}},data:{metadata:{...meta,state:"SENDING"}}});
    if(!claimed.count)throw new WhatsAppSendError("Este anexo já está em processamento.",409);
    try{
      await whatsappSendAccess(id);
      const sent=await sendUazapiMedia({organizationId:member.organizationId,accountRecipient:account.recipient!,to:parseWhatsappChannelAddress(ticket.senderEmail).externalId,type:input.asDocument?"document":info.type,file:signed.data.signedUrl,name:info.name,mimeType:info.mimeType,caption:signedWhatsappText(member.user.name,input.caption||info.name),trackingId:draft.id,replyToMessageId:replyTarget?.providerId});
      const now=new Date();
      const message=await prisma.$transaction(async tx=>{
        const result=await tx.serviceMessage.upsert({where:{ticketId_externalMessageId:{ticketId:ticket.id,externalMessageId:sent.messageId}},create:{ticketId:ticket.id,externalMessageId:sent.messageId,direction:"OUTBOUND",deliveryStatus:"accepted",statusUpdatedAt:now,fromName:member.user.name||member.user.email,fromEmail:member.user.email,toEmails:[ticket.senderEmail],textBody:input.caption||info.name,receivedAt:now,providerMetadata:{provider:"UAZAPI",connectionId:sent.connectionId,instanceId:sent.instanceId,accountPhone:sent.accountPhone,messageId:sent.providerMessageId,uploadId:draft.id,...(replyTarget?{replyToMessageId:replyTarget.quote.id!}:{})}},update:{}});
        await tx.serviceAttachment.upsert({where:{id:`wa_upload_${draft.id}`},create:{id:`wa_upload_${draft.id}`,messageId:result.id,name:info.name,mimeType:info.mimeType,size:Number(meta.size),storagePath:path,externalAttachmentId:`uazapi:${sent.instanceId}:${sent.providerMessageId}`},update:{}});
        await tx.serviceTicket.updateMany({where:{id:ticket.id,assignedToId:member.userId,status:{notIn:["RESOLVED","SPAM"]}},data:{lastMessageAt:now,snippet:(input.caption||info.name).slice(0,220),status:"IN_PROGRESS"}});
        await tx.serviceTicket.updateMany({where:{id:ticket.id,firstResponseAt:null},data:{firstResponseAt:now}});
        await tx.serviceTicketHistory.update({where:{id:draft.id},data:{message:"Anexo enviado pelo WhatsApp.",metadata:{...meta,state:"SENT",messageId:result.id,externalMessageId:sent.messageId}}});
        return result;
      });
      return NextResponse.json({ok:true,messageId:message.id});
    }catch(error){
      await prisma.serviceTicketHistory.updateMany({where:{id:draft.id,metadata:{path:["state"],equals:"SENDING"}},data:{metadata:{...meta,state:"UNCONFIRMED"},message:"Envio de anexo sem confirmação. Conferir no WhatsApp antes de repetir."}});
      throw new WhatsAppSendError(error instanceof WhatsAppSendError?error.message:"O envio do anexo não foi confirmado. Confira a conversa antes de repetir.",error instanceof WhatsAppSendError?error.status:502);
    }
  }catch(error){return NextResponse.json({error:error instanceof z.ZodError?"Dados do anexo inválidos.":error instanceof WhatsAppSendError||error instanceof WhatsAppFileError||error instanceof ReplyTargetError?error.message:"Não foi possível enviar o anexo."},{status:error instanceof WhatsAppSendError||error instanceof ReplyTargetError?error.status:error instanceof z.ZodError||error instanceof WhatsAppFileError?400:500});}
}
