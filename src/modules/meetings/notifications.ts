import { prisma } from "@/lib/prisma";
import { dayKey } from "./model";
export async function meetingNotifications(organizationId: string, userId: string, now = new Date()) {
 const nextDay=new Date(+now+86400000),recent=new Date(+now-7*86400000);
 const [actions,meetings,deliveries]=await Promise.all([
  prisma.meetingActionItem.findMany({where:{responsibleId:userId,completedAt:null,dueAt:{lte:nextDay},meeting:{organizationId,deletedAt:null,status:{not:"CANCELLED"}}},orderBy:{dueAt:"asc"},take:20,include:{meeting:{select:{title:true}}}}),
  prisma.teamMeeting.findMany({where:{organizationId,deletedAt:null,status:"SCHEDULED",participants:{some:{userId}},startsAt:{gte:now,lte:nextDay}},take:15,orderBy:{startsAt:"asc"}}),
  prisma.meetingDelivery.findMany({where:{organizationId,userId,createdAt:{gte:recent},OR:[{meeting:{deletedAt:null,status:{not:"CANCELLED"},participants:{some:{userId}}},OR:[{actionItemId:null},{actionItem:{responsibleId:userId,completedAt:null}}]},{dedupeKey:{startsWith:"meeting-deleted:"}},{dedupeKey:{startsWith:"meeting-cancelled:"}}]},orderBy:{createdAt:"desc"},take:20,include:{meeting:{select:{deletedAt:true}}}})
 ]);
 return [
  ...meetings.map(meeting=>{const soon=+meeting.startsAt-+now<=15*60000;return {id:`meeting-soon:${meeting.id}:${meeting.revision}:${soon?"starting":"today"}:${dayKey(now)}`,type:"INFO" as const,title:soon?"Sua reunião começa em breve":"Reunião nas próximas 24 horas",description:`${meeting.title} · ${meeting.startsAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}`,href:`/reunioes?meeting=${encodeURIComponent(meeting.id)}`,createdAt:now.toISOString(),popup:soon,priority:soon?30:10};}),
  ...actions.map(action=>({id:`meeting-action:${action.id}:${action.revision}:${dayKey(now)}`,type:action.dueAt<now?"WARNING" as const:"INFO" as const,title:action.dueAt<now?"Entrega de reunião atrasada":"Entrega de reunião próxima",description:`${action.title} · ${action.meeting.title} · ${action.dueAt.toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}`,href:`/reunioes?meeting=${encodeURIComponent(action.meetingId)}`,createdAt:now.toISOString(),popup:true,priority:20})),
  ...deliveries.map(item=>({id:`meeting-invite:${item.id}`,type:"INFO" as const,title:item.title,description:item.body,href:item.meeting.deletedAt?"/agenda":`/reunioes?meeting=${encodeURIComponent(item.meetingId)}`,createdAt:item.createdAt.toISOString(),popup:+now-+item.createdAt<=86400000,priority:+now-+item.createdAt<=86400000?25:15}))
 ];
}
