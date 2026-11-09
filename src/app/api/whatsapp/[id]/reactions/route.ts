import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {whatsappSendAccess,WhatsAppSendError} from "@/modules/whatsapp/outbound-access";
import {storeOwnReaction} from "@/modules/whatsapp/reactions";
import {validReactionEmoji} from "@/modules/whatsapp/reaction-core";
import {accountMessageWhere} from "@/modules/whatsapp/account-scope";
import {sendUazapiReaction} from "@/modules/whatsapp/uazapi-server";
import {object,text} from "@/modules/whatsapp/uazapi";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    const {id}=await context.params;
    const {member,ticket,account}=await whatsappSendAccess(id);
    const body=await request.json();
    if(typeof body.messageId!=="string"||body.messageId.length>100||!validReactionEmoji(body.emoji))throw new WhatsAppSendError("Escolha uma mensagem e um emoji válido.");
    const message=await prisma.serviceMessage.findFirst({where:{id:body.messageId,direction:"INBOUND",...accountMessageWhere(account.connection),ticket:{...account.where,senderEmail:ticket.senderEmail,isSpam:false,mergedIntoId:null,OR:[{id:ticket.id},{status:"RESOLVED"}]}},select:{id:true,externalMessageId:true,providerMetadata:true,receivedAt:true}});
    if(!message)throw new WhatsAppSendError("Mensagem não encontrada nesta conversa.",404);
    if(Date.now()-message.receivedAt.getTime()>7*24*60*60*1000)throw new WhatsAppSendError("A Uazapi permite reagir a mensagens dos últimos 7 dias.");
    const meta=object(message.providerMetadata);
    const external=text(meta.messageId)||message.externalMessageId?.split(":").at(-1);
    if(!external||!message.externalMessageId?.startsWith("uazapi:"))throw new WhatsAppSendError("Esta mensagem não está disponível na integração atual.");
    try{await sendUazapiReaction({organizationId:member.organizationId,accountRecipient:account.recipient!,messageId:external,emoji:body.emoji});}catch(error){throw new WhatsAppSendError(error instanceof Error?error.message:"Não foi possível confirmar a reação.",502);}
    const reaction={emoji:body.emoji,name:member.user.name||member.user.email};
    await storeOwnReaction(message.id,reaction.emoji,reaction.name);
    await prisma.serviceTicket.update({where:{id:ticket.id},data:{updatedAt:new Date()}});
    return NextResponse.json({messageId:message.id,reaction});
  }catch(error){return NextResponse.json({error:error instanceof WhatsAppSendError?error.message:"Não foi possível reagir à mensagem."},{status:error instanceof WhatsAppSendError?error.status:502});}
}
