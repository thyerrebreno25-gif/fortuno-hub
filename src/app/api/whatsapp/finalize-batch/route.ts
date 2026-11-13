import {finalizationNote} from "@/modules/whatsapp/finalization";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission, SERVICE_CENTER_MANAGER_ROLES } from "@/modules/atendimento/auth";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { inboxWhere } from "@/modules/whatsapp/inbox-filters";
import { unreadCounts } from "@/modules/whatsapp/read-state";
import type { Prisma } from "@/generated/prisma/client";

export const maxDuration=60;
const filtersSchema = z.object({view:z.enum(["GENERAL","MINE","QUEUE"]),kind:z.enum(["ALL","GROUP","CONTACT"]),status:z.enum(["ALL","OPEN","RESOLVED"]),search:z.string().max(200).default(""),onlyUnread:z.boolean().default(false)});
const inputSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("preview"),filters:filtersSchema}),
  z.object({action:z.literal("confirm"),tickets:z.array(z.object({id:z.string().min(1).max(100),updatedAt:z.string().datetime()})).min(1).max(5000).refine(rows=>new Set(rows.map(r=>r.id)).size===rows.length)}),
]);

export async function POST(request:Request) {
  const member=await getServiceCenterMember();
  if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  const permission=await getWhatsAppPermission(member.organizationId,member.role);
  if(member.role==="CLIENT"||!permission.canView||!permission.canEdit)return NextResponse.json({error:"Sem permissão para finalizar chamados."},{status:403});
  const parsed=inputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Revise os chamados selecionados."},{status:400});
  const account=await currentWhatsAppAccount(member.organizationId);
  if(!account.recipient)return NextResponse.json({error:"A conexão mudou ou está desconectada. Atualize a central."},{status:409});
  const canManage=permission.canManage||SERVICE_CENTER_MANAGER_ROLES.has(member.role);
  const base:Prisma.ServiceTicketWhereInput={...account.where,mergedIntoId:null,isSpam:false,status:{notIn:["RESOLVED","SPAM"]},...(!canManage?{assignedToId:member.userId}:{})};
  if(parsed.data.action==="preview") {
    const {filters}=parsed.data;
    const AND:Prisma.ServiceTicketWhereInput[]=[inboxWhere(filters,member.userId)];
    const needle=filters.search.trim();
    if(needle)AND.push({OR:[{subject:{contains:needle,mode:"insensitive"}},{senderName:{contains:needle,mode:"insensitive"}},{senderEmail:{contains:needle,mode:"insensitive"}},{snippet:{contains:needle,mode:"insensitive"}},{client:{name:{contains:needle,mode:"insensitive"}}}]});
    if(filters.onlyUnread)AND.push({id:{in:[...(await unreadCounts(member.organizationId,member.userId)).keys()]}});
    const tickets=await prisma.serviceTicket.findMany({where:{...base,AND},orderBy:[{lastMessageAt:"desc"},{id:"asc"}],take:5001,select:{id:true,updatedAt:true,senderName:true,subject:true,client:{select:{name:true}},assignedTo:{select:{name:true}}}});
    if(tickets.length>5000)return NextResponse.json({error:"Há mais de 5.000 chamados. Use os filtros para reduzir o lote."},{status:400});
    return NextResponse.json({tickets,canManage},{headers:{"Cache-Control":"private, no-store"}});
  }
  const snapshots=parsed.data.tickets;
  // Compare the reviewed versions atomically: new messages, transfers and prior
  // closures invalidate a row instead of silently closing a changed conversation.
  const closed=await prisma.$transaction(async tx=>{
    const now=new Date();
    const rows=await tx.serviceTicket.updateManyAndReturn({where:{...base,OR:snapshots.map(t=>({id:t.id,updatedAt:new Date(t.updatedAt)}))},data:{status:"RESOLVED",resolvedAt:now,resolvedById:member.userId},select:{id:true}});
    if(rows.length)await tx.serviceTicketHistory.createMany({data:rows.map(t=>({ticketId:t.id,userId:member.userId,type:"WHATSAPP_RESOLVED",message:"Atendimento finalizado em lote."}))});
    if(rows.length)await tx.serviceMessage.createMany({data:rows.map(t=>finalizationNote(t.id,member,now,account.connection?.phone||account.recipient?.split(":").at(-1)))});
    return rows;
  });
  return NextResponse.json({closedIds:closed.map(t=>t.id),skipped:snapshots.length-closed.length});
}
