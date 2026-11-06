import {currentDirectoryVisibility} from "@/modules/whatsapp/directory-core";
import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {whatsappConnection} from "@/modules/whatsapp/uazapi-server";
import {normalizeWhatsappIdentity,whatsappChannelAddress} from "@/modules/whatsapp/core";
import {resolveWhatsappRouting} from "@/modules/whatsapp/server";
import {chatLock} from "@/modules/whatsapp/merge";
export async function POST(_request:Request,context:{params:Promise<{id:string}>}){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canEdit)return NextResponse.json({error:"Sem permissão."},{status:403});
 const connection=await whatsappConnection(member.organizationId);
 if(!connection?.phone||connection.status!=="CONNECTED"||connection.expiresAt&&connection.expiresAt<new Date())return NextResponse.json({error:"Conecte o WhatsApp antes de abrir a conversa."},{status:409});
 const {id}=await context.params;
 const entry=await prisma.whatsAppDirectoryEntry.findFirst({where:{id,organizationId:member.organizationId,connectionId:connection.id,accountPhone:connection.phone,active:true,AND:[currentDirectoryVisibility()]}});
 if(!entry)return NextResponse.json({error:"Contato ou grupo não encontrado na conta conectada."},{status:404});
 const kind=entry.kind==="GROUP"?"GROUP":"CONTACT",identifier=normalizeWhatsappIdentity(kind,entry.externalId),senderEmail=whatsappChannelAddress(kind,identifier),recipientEmail=`wa-account:${connection.id}:${connection.phone}`;
 const routing=await resolveWhatsappRouting({organizationId:member.organizationId,kind,identifier,displayName:entry.displayName,routingArea:"GENERAL"});
 const ticket=await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(connection.id,senderEmail)}))`;
  const current=await tx.whatsAppConnection.findFirst({where:{id:connection.id,organizationId:member.organizationId,instanceId:connection.instanceId,phone:connection.phone,status:"CONNECTED"},select:{id:true}});
  if(!current)return null;
  const existing=await tx.serviceTicket.findFirst({where:{organizationId:member.organizationId,source:"WHATSAPP_API",senderEmail,mergedIntoId:null,isSpam:false,status:{notIn:["RESOLVED","SPAM"]},recipientEmail},orderBy:{lastMessageAt:"desc"},select:{id:true}});
  if(existing)return existing;
  return tx.serviceTicket.create({data:{organizationId:member.organizationId,source:"WHATSAPP_API",subject:entry.displayName,senderName:entry.displayName,senderEmail,recipientEmail,clientId:routing.clientId,routingArea:"GENERAL",routingSquad:routing.routingSquad,routingReason:routing.reason,assignedToId:routing.assignedToId||member.userId,assignedAt:new Date(),status:"IN_PROGRESS",history:{create:{userId:member.userId,type:"WHATSAPP_DIRECTORY_OPENED",message:"Conversa aberta pela agenda. Nenhuma mensagem enviada."}}},select:{id:true}});
 });
 return ticket?NextResponse.json({ticketId:ticket.id}):NextResponse.json({error:"A conexão mudou. Atualize a agenda."},{status:409});
}
