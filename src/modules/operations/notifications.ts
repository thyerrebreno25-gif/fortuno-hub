import {prisma} from "@/lib/prisma";
import {dayKey} from "@/modules/meetings/model";
import {activityDueDay,activityOverdue,operationDayRange,operationToday} from "./activity-deadline";
export async function activityNotifications(organizationId:string,userId:string,now=new Date()){
 const scope={organizationId,responsibleId:userId,deletedAt:null,status:{notIn:["COMPLETED" as const,"DISREGARDED" as const]}};
 const today=operationToday(now),afterTomorrow=new Date(+operationDayRange(today).lt+86400000).toISOString().slice(0,10);
 const [assigned,due]=await Promise.all([
  prisma.operationActivity.findMany({where:{...scope,events:{some:{type:{in:["ASSIGNED"]},createdAt:{gte:new Date(+now-7*86400000)}}}},select:{id:true,title:true,client:{select:{name:true}},events:{where:{type:{in:["ASSIGNED"]}},orderBy:{createdAt:"desc"},take:1,select:{id:true,createdAt:true}}},orderBy:{updatedAt:"desc"},take:20}),
  prisma.operationActivity.findMany({where:{...scope,OR:[{scheduledDate:{lt:new Date(afterTomorrow+"T00:00:00Z")}},{scheduledDate:null,dueAt:{lt:new Date(afterTomorrow+"T00:00:00-03:00")}}]},orderBy:[{scheduledDate:"asc"},{dueAt:"asc"}],take:20,select:{id:true,title:true,scheduledDate:true,dueAt:true,updatedAt:true,client:{select:{name:true}}}})
 ]);
 return [...assigned.filter(activity=>activity.events.length).map(activity=>({id:`operation-assigned:${activity.id}:${activity.events[0].id}`,type:"INFO" as const,title:"Atividade atribuída a você",description:`${activity.title} · ${activity.client.name}`,href:`/operacoes?activity=${encodeURIComponent(activity.id)}`,createdAt:activity.events[0].createdAt.toISOString(),popup:+now-+activity.events[0].createdAt<=86400000,priority:+now-+activity.events[0].createdAt<=86400000?25:15})),...due.map(activity=>{const date=activityDueDay(activity),overdue=activityOverdue(activity,now);return {id:`operation-due:${activity.id}:${date}:${overdue?"overdue":"soon"}:${dayKey(now)}`,type:overdue?"WARNING" as const:"INFO" as const,title:overdue?"Atividade com prazo vencido":date===today?"Atividade para hoje":"Atividade próxima do prazo",description:`${activity.title} · ${activity.client.name} · ${date?.split("-").reverse().join("/")||"Sem data"}`,href:`/operacoes?activity=${encodeURIComponent(activity.id)}`,createdAt:now.toISOString(),reminderDay:dayKey(now),originAt:activity.updatedAt?.toISOString(),popup:true,priority:20};})];
}
