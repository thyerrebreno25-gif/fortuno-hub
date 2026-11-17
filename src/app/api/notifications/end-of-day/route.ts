import {overdueActivityDates} from "@/modules/operations/activity-deadline";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentMember, getRolePermissions } from "@/modules/permissions/permissions";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
import { endOfDayWindow, type EndOfDaySummary } from "@/modules/notifications/end-of-day-policy";

const headers = {"Cache-Control":"private, no-store"};
const ACK = "END_OF_DAY_ACK";
export async function GET() {
  try {
    const member = await getCurrentMember();
    if (!member) return NextResponse.json({error:"Sessão inválida."},{status:401});
    if (member.role === "CLIENT") return NextResponse.json({error:"Acesso restrito à equipe."},{status:403});
    const now = new Date(), w = endOfDayWindow(now);
    const base:EndOfDaySummary={day:w.day,tomorrow:w.tomorrow,eligible:false,acknowledged:false,viewerKey:`${member.organizationId}:${member.userId}`,calls:null,email:null,tasks:null,overdue:null,unread:null,agenda:[],agendaTotal:0,calendarAvailable:false};
    if (!w.due) return NextResponse.json(base,{headers});
    const [holiday,ack,permissions] = await Promise.all([
      prisma.operationHoliday.count({where:{organizationId:member.organizationId,date:{gte:new Date(w.day+"T00:00:00Z"),lt:new Date(w.tomorrow+"T00:00:00Z")}}}),
      prisma.auditLog.findFirst({where:{userId:member.userId,action:ACK,entity:"Organization",entityId:member.organizationId,createdAt:{gte:w.start,lt:w.end}},select:{id:true}}),
      getRolePermissions(member.organizationId,member.role),
    ]);
    if (holiday || ack) return NextResponse.json({...base,acknowledged:Boolean(ack)},{headers});
    const org = member.organizationId, user = member.userId;
    const account = permissions.WHATSAPP.canView ? await currentWhatsAppAccount(org) : null;
    const pending = {organizationId:org,responsibleId:user,deletedAt:null,status:{in:["OPEN","IN_PROGRESS","BLOCKED"] as ("OPEN"|"IN_PROGRESS"|"BLOCKED")[]}};
    const agendaWhere = {organizationId:org,userId:user,status:"ACTIVE",startsAt:{lt:w.tomorrowEnd},endsAt:{gt:w.end},OR:[{meetingId:null},{meeting:{deletedAt:null,status:{not:"CANCELLED" as const}}}]};
    const [calls,email,tasks,overdue,unread,events,agendaTotal] = await Promise.all([
      account ? prisma.serviceTicket.count({where:{...account.where,assignedToId:user,mergedIntoId:null,isSpam:false,status:{notIn:["SPAM","RESOLVED"]}}}) : null,
      permissions.SERVICE_CENTER.canView ? prisma.serviceTicket.count({where:{organizationId:org,source:{in:["GMAIL","MANUAL"]},assignedToId:user,mergedIntoId:null,isSpam:false,status:{notIn:["SPAM","RESOLVED"]},history:{none:{type:"MAILBOX_ARCHIVED"}}}}) : null,
      permissions.OPERATIONS.canView ? prisma.operationActivity.count({where:{...pending,OR:[{scheduledDate:{lt:new Date(w.tomorrow+"T00:00:00Z")}},{scheduledDate:null,dueAt:{lt:w.end}},{scheduledDate:null,dueAt:null}]}}) : null,
      permissions.OPERATIONS.canView ? prisma.operationActivity.count({where:{...pending,...overdueActivityDates(now)}}) : null,
      permissions.NOTICES.canView ? prisma.notice.count({where:{organizationId:org,closedAt:null,OR:[{expiresAt:null},{expiresAt:{gte:now}}],recipients:{some:{memberId:member.id,viewedAt:null,completedAt:null}}}}) : null,
      permissions.CALENDAR.canView ? prisma.teamCalendarEvent.findMany({where:agendaWhere,orderBy:[{startsAt:"asc"},{id:"asc"}],take:100,select:{id:true,title:true,startsAt:true,endsAt:true,meetingId:true}}) : [],
      permissions.CALENDAR.canView ? prisma.teamCalendarEvent.count({where:agendaWhere}) : 0,
    ]);
    return NextResponse.json({...base,eligible:true,calls,email,tasks,overdue,unread,agendaTotal,calendarAvailable:permissions.CALENDAR.canView,
      agenda:events.map(e=>({id:e.id,title:e.title,startsAt:e.startsAt.toISOString(),endsAt:e.endsAt.toISOString(),href:e.meetingId?`/reunioes?meeting=${encodeURIComponent(e.meetingId)}`:"/agenda"}))},{headers});
  } catch { return NextResponse.json({error:"Não foi possível consultar suas pendências."},{status:503,headers}); }
}

export async function POST() {
  try {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({error:"Sessão inválida."},{status:401});
  if (member.role === "CLIENT") return NextResponse.json({error:"Acesso restrito à equipe."},{status:403});
  const w = endOfDayWindow();
  if (!w.due) return NextResponse.json({error:"Resumo disponível após as 18h dos dias úteis."},{status:400});
  await prisma.auditLog.create({data:{userId:member.userId,action:ACK,entity:"Organization",entityId:member.organizationId,afterData:{day:w.day}}});
  return NextResponse.json({acknowledged:true,day:w.day},{headers});
  } catch { return NextResponse.json({error:"Não foi possível registrar a leitura."},{status:503,headers}); }
}
