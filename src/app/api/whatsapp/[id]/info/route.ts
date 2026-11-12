import { currentWhatsAppAccount, accountMessageWhere } from "@/modules/whatsapp/account-scope";
import {NextResponse} from "next/server";
import {resolvedChatProfile,rememberChatName} from "@/modules/whatsapp/contact-profile";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {resolveWhatsappTicketId} from "@/modules/whatsapp/server";
import {parseWhatsappChannelAddress} from "@/modules/whatsapp/core";
import {whatsappConnection} from "@/modules/whatsapp/uazapi-server";
import {mediaKind} from "@/modules/whatsapp/media";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView)return NextResponse.json({error:"Sem permissão."},{status:403});
 const {id}=await context.params,ticketId=await resolveWhatsappTicketId(id,member.organizationId);
 const ticket=await prisma.serviceTicket.findFirst({where:{id:ticketId,...(await currentWhatsAppAccount(member.organizationId)).where},select:{id:true,senderEmail:true,senderName:true,recipientEmail:true,subject:true,client:{select:{name:true}},assignedTo:{select:{name:true,email:true}}}});
 if(!ticket)return NextResponse.json({error:"Conversa não encontrada."},{status:404});
 const params=new URL(request.url).searchParams,section=params.get("section")||"profile",page=Number(params.get("page")||1);
 if(!["profile","files"].includes(section)||!Number.isSafeInteger(page)||page<1||page>100000)return NextResponse.json({error:"Filtro inválido."},{status:400});
 if(section==="files"){
  const where={message:{ticketId:ticket.id,...accountMessageWhere((await currentWhatsAppAccount(member.organizationId)).connection),ticket:{organizationId:member.organizationId,source:"WHATSAPP_API"}},externalAttachmentId:{startsWith:"uazapi:"}};
  const [rows,total]=await Promise.all([prisma.serviceAttachment.findMany({where,select:{id:true,name:true,mimeType:true,size:true,message:{select:{receivedAt:true,textBody:true}}},orderBy:[{message:{receivedAt:"desc"}},{id:"desc"}],skip:(page-1)*40,take:40}),prisma.serviceAttachment.count({where})]);
  return NextResponse.json({ticketId:ticket.id,total,files:rows.map(row=>({id:row.id,name:row.name,mimeType:row.mimeType,size:row.size,date:row.message.receivedAt,kind:mediaKind(row.mimeType,row.name,row.message.textBody||"")}))});
 }
 const channel=parseWhatsappChannelAddress(ticket.senderEmail), group=channel.kind==="GROUP",connection=await whatsappConnection(member.organizationId);
 const local={ticketId:ticket.id,name:ticket.senderName||ticket.subject,group,identifier:channel.externalId,client:ticket.client?.name||null,operator:ticket.assignedTo?.name||ticket.assignedTo?.email||null};
 if(!connection?.phone||connection.status!=="CONNECTED"||connection.expiresAt&&connection.expiresAt<new Date()||ticket.recipientEmail!==`wa-account:${connection.id}:${connection.phone}`)return NextResponse.json({...local,profile:null,warning:"Dados do WhatsApp indisponíveis: a conversa não pertence à conta atualmente conectada ou a conexão está inativa."});
 try{
  const profile=await resolvedChatProfile(connection,channel.externalId,group);
  await rememberChatName(connection,ticket.senderEmail,profile.name);
  return NextResponse.json({...local,profile});
 }catch{return NextResponse.json({...local,profile:null,warning:"Não foi possível atualizar as informações no WhatsApp. As mídias sincronizadas continuam disponíveis."});}
}
