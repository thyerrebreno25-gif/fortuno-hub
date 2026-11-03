import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getServiceCenterPermission,SERVICE_CENTER_MANAGER_ROLES} from "@/modules/atendimento/auth";
import {emailChannel} from "@/modules/atendimento/email-channel";
import {emailMetrics} from "@/modules/atendimento/email-analytics";
import type {Prisma} from "@/generated/prisma/client";
export async function GET(request:Request){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getServiceCenterPermission(member.organizationId,member.role);if(!permission.canView||!(permission.canManage||SERVICE_CENTER_MANAGER_ROLES.has(member.role)))return NextResponse.json({error:"Painel restrito à gestão."},{status:403});
 const params=new URL(request.url).searchParams, today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 const to=params.get('to')||today,from=params.get('from')||new Date(Date.now()-29*86400000).toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
 const start=new Date(from+'T00:00:00-03:00'),end=new Date(to+'T23:59:59.999-03:00');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start>end||new Date(from+"T12:00:00Z").toISOString().slice(0,10)!==from||new Date(to+"T12:00:00Z").toISOString().slice(0,10)!==to||end.getTime()-start.getTime()>366*86400000)return NextResponse.json({error:"Selecione um período válido de até um ano."},{status:400});
 const where:Prisma.ServiceTicketWhereInput={organizationId:member.organizationId,...emailChannel,mergedIntoId:null,receivedAt:{gte:start,lte:end}};
 const clientId=params.get('clientId'),assignedToId=params.get('assignedToId');if(clientId)where.clientId=clientId==='NONE'?null:clientId;if(assignedToId)where.assignedToId=assignedToId==='NONE'?null:assignedToId;
 const by=['clientId','assignedToId','status','isSpam'] as const;
 const [groups,answered,clients,members]=await Promise.all([
  prisma.serviceTicket.groupBy({by:[...by],where,_count:{_all:true}}),
  prisma.serviceTicket.groupBy({by:[...by],where:{...where,messages:{some:{direction:'OUTBOUND'}}},_count:{_all:true}}),
  prisma.client.findMany({where:{organizationId:member.organizationId},select:{id:true,name:true}}),
  prisma.organizationMember.findMany({where:{organizationId:member.organizationId},select:{user:{select:{id:true,name:true,email:true}}}})
 ]);
 const users=members.map(m=>m.user),known=new Set(users.map(u=>u.id)),former=[...new Set(groups.map(g=>g.assignedToId).filter((id):id is string=>Boolean(id&&!known.has(id))))];if(former.length)users.push(...await prisma.user.findMany({where:{id:{in:former}},select:{id:true,name:true,email:true}}));
 return NextResponse.json({...emailMetrics(groups,answered,clients,users),from,to},{headers:{'Cache-Control':'private, no-store'}});
}
