import {scheduledBatchExists} from "@/modules/whatsapp/broadcast-schedule-guard";
import {BROADCAST_RECIPIENT_LIMIT} from "@/modules/whatsapp/broadcast-policy";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { prepareBatchSchema, deliverBatchSchema } from "@/modules/whatsapp/batch-schema";
import { deliverBatchMessage } from "@/modules/whatsapp/batch-send";
import {batchAddress,batchClientRecipient} from "@/modules/whatsapp/batch-recipients";
import type { Prisma } from "@/generated/prisma/client";
export const maxDuration = 60;
async function access() {
  const member=await getServiceCenterMember();
  if(!member || member.role === "CLIENT")return null;
  const permission=await getWhatsAppPermission(member.organizationId,member.role);
  return permission.canView&&permission.canEdit?{member}:null;
}
export async function GET(request:Request) {
  const viewer=await access();if(!viewer)return NextResponse.json({error:"Sem permissão de envio."},{status:403});
  const {member}=viewer,params=new URL(request.url).searchParams,account=await currentWhatsAppAccount(member.organizationId);
  const batchId=params.get("batchId");
  if(batchId){
    if(!/^[\da-f-]{36}$/i.test(batchId))return NextResponse.json({error:"Lote inválido."},{status:400});
    const rows=await prisma.whatsAppBatchDelivery.findMany({where:{organizationId:member.organizationId,userId:member.userId,batchId,accountRecipient:account.recipient||"disconnected"},orderBy:[{createdAt:"asc"},{id:"asc"}],select:{id:true,recipientName:true,status:true,error:true,body:true,updatedAt:true}});
    return NextResponse.json({deliveries:rows.map((row,index)=>({...row,body:index===0?row.body:undefined}))},{headers:{"Cache-Control":"private, no-store"}});
  }
  const search=(params.get("search")||"").trim(),page=Number(params.get("page")||1);
  if(search.length>150||!Number.isSafeInteger(page)||page<1||page>10000)return NextResponse.json({error:"Filtro inválido."},{status:400});
  const ticketScope:Prisma.ServiceTicketWhereInput={...account.where,mergedIntoId:null,isSpam:false,status:{not:"SPAM"}};
  const matchingTicket:Prisma.ServiceTicketWhereInput={...ticketScope,...(search?{OR:[{senderName:{contains:search,mode:"insensitive"}},{senderEmail:{contains:search,mode:"insensitive"}}]}:{})};
  const where:Prisma.ClientWhereInput={organizationId:member.organizationId,active:true,serviceTickets:{some:ticketScope},...(search?{OR:[{name:{contains:search,mode:"insensitive"}},{serviceTickets:{some:matchingTicket}}]}:{})};
  const all=params.get("all")==="1",pageSize=all?BROADCAST_RECIPIENT_LIMIT:50;
  const [clients,total]=await Promise.all([prisma.client.findMany({where,orderBy:[{name:"asc"},{id:"asc"}],skip:all?0:(page-1)*50,take:pageSize,select:{id:true,name:true,serviceTickets:{where:ticketScope,orderBy:[{lastMessageAt:"desc"},{id:"asc"}],select:{id:true,senderName:true,subject:true,senderEmail:true,status:true,lastMessageAt:true,assignedTo:{select:{name:true,email:true}}}}}}),prisma.client.count({where})]);
  const items=clients.map(batchClientRecipient);
  return NextResponse.json({items,total,pageSize},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request) {
  const viewer=await access();if(!viewer)return NextResponse.json({error:"Sem permissão de envio."},{status:403});
  const input=await request.json().catch(()=>null),{member}=viewer;
  if(input?.action==="deliver") {
    const parsed=deliverBatchSchema.safeParse(input);if(!parsed.success)return NextResponse.json({error:"Envio inválido."},{status:400});
    return deliverBatchMessage(parsed.data.deliveryId,member);
  }
  const parsed=prepareBatchSchema.safeParse(input);if(!parsed.success)return NextResponse.json({error:"Revise a mensagem e selecione de 1 a 1.000 clientes diferentes."},{status:400});
  const account=await currentWhatsAppAccount(member.organizationId);if(!account.recipient)return NextResponse.json({error:"Conecte o WhatsApp antes de preparar o lote."},{status:409});
  const tickets=await prisma.serviceTicket.findMany({where:{...account.where,id:{in:parsed.data.ticketIds},mergedIntoId:null,isSpam:false,status:{not:"SPAM"},client:{active:true}},select:{id:true,senderName:true,subject:true,senderEmail:true,clientId:true,client:{select:{name:true}}}});
  if(tickets.length!==parsed.data.ticketIds.length)return NextResponse.json({error:"Uma conversa não está disponível nesta conexão. Revise os destinatários."},{status:409});
  if(tickets.some(t=>!t.clientId)||new Set(tickets.map(t=>t.clientId)).size!==tickets.length)return NextResponse.json({error:"Selecione apenas um contato ou grupo vinculado por cliente."},{status:400});
  if(parsed.data.recipients?.some(row=>tickets.find(ticket=>ticket.id===row.ticketId)?.clientId!==row.clientId))return NextResponse.json({error:"O vínculo de um destinatário mudou. Atualize a lista de clientes antes de enviar."},{status:409});
  if(new Set(tickets.map(t=>batchAddress(t.senderEmail))).size!==tickets.length)return NextResponse.json({error:"O mesmo contato ou grupo está vinculado a mais de um cliente selecionado. Revise os destinos."},{status:400});
  const where={organizationId:member.organizationId,userId:member.userId,batchId:parsed.data.batchId};
  const deliveries=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${member.organizationId}:${member.userId}:${parsed.data.batchId}`}))`;
    if(await scheduledBatchExists(tx,member.organizationId,parsed.data.batchId))return null;
    const existing=await tx.whatsAppBatchDelivery.findMany({where});
    if(existing.length)return existing.length===parsed.data.ticketIds.length&&existing.every(d=>d.body===parsed.data.content&&d.accountRecipient===account.recipient&&parsed.data.ticketIds.includes(d.ticketId))?existing:null;
    await tx.whatsAppBatchDelivery.createMany({data:tickets.map(t=>({...where,ticketId:t.id,accountRecipient:account.recipient!,recipientName:`${t.client!.name} · ${t.senderName||t.subject}`,body:parsed.data.content}))});
    return tx.whatsAppBatchDelivery.findMany({where,orderBy:{id:"asc"}});
  });
  if(!deliveries)return NextResponse.json({error:"O lote já foi preparado com outra mensagem ou outros destinatários. Reabra o lote e confira o conteúdo salvo."},{status:409});
  return NextResponse.json({batchId:parsed.data.batchId,deliveries:deliveries.map((d,index)=>({id:d.id,recipientName:d.recipientName,status:d.status,error:d.error,body:index===0?d.body:undefined,updatedAt:d.updatedAt}))});
}
