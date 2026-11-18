import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {dayKey} from "./model";

type DailyOccurrence={id:string;organizationId:string;type:string;creationKey:string|null;startsAt:Date;status:string;deletedAt?:Date|null};
/** References the original action. It never copies an action, extends its
 * deadline or creates another calendar event. Future Dailies activate on their
 * Brasília date, so pending work is not spread across every future occurrence. */
export function dailyCarryoverWhere(meeting:DailyOccurrence,now=new Date()):Prisma.MeetingActionItemWhereInput|null {
 if(meeting.type!=="Daily"||!meeting.creationKey||meeting.deletedAt||meeting.status==="CANCELLED"||dayKey(meeting.startsAt)>dayKey(now))return null;
 const start=new Date(`${dayKey(meeting.startsAt)}T00:00:00-03:00`),end=new Date(+start+86400000);
 return {meeting:{organizationId:meeting.organizationId,creationKey:meeting.creationKey,type:"Daily",deletedAt:null,status:{not:"CANCELLED"},startsAt:{lt:start}},createdAt:{lt:end},OR:[{completedAt:null},{completedAt:{gte:start}}]};
}
export async function dailyCarryoverActions(meeting:DailyOccurrence,now=new Date()) {
 const where=dailyCarryoverWhere(meeting,now);
 if(!where)return {actions:[],total:0};
 const [actions,total]=await Promise.all([
  prisma.meetingActionItem.findMany({where,include:{responsible:{select:{id:true,name:true,email:true}},meeting:{select:{id:true,title:true,startsAt:true}}},orderBy:[{dueAt:"asc"},{id:"asc"}],take:500}),
  prisma.meetingActionItem.count({where}),
 ]);
 return {actions:actions.map(({meeting:origin,...action})=>({...action,origin})),total};
}
/** One aggregate per visible occurrence, executed together in the database.
 * No action bodies or participant information are read for list counters. */
export async function dailyCarryoverCounts(meetings:DailyOccurrence[],now=new Date()) {
 const eligible=meetings.filter(meeting=>dailyCarryoverWhere(meeting,now));
 if(!eligible.length)return new Map<string,number>();
 const rows=await prisma.$queryRaw<Array<{id:string;pending:number}>>(Prisma.sql`
  SELECT t.id,COUNT(a.id)::int AS pending FROM "TeamMeeting" t
  JOIN "TeamMeeting" s ON s."organizationId"=t."organizationId" AND s."creationKey"=t."creationKey" AND s.type='Daily' AND s."deletedAt" IS NULL AND s.status<>'CANCELLED'
   AND s."startsAt" < (((t."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC')
  JOIN "MeetingActionItem" a ON a."meetingId"=s.id AND a."completedAt" IS NULL
   AND a."createdAt" < ((((t."startsAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date+1)::timestamp) AT TIME ZONE 'America/Sao_Paulo' AT TIME ZONE 'UTC')
  WHERE t."organizationId"=${eligible[0].organizationId} AND t.id IN (${Prisma.join(eligible.map(meeting=>meeting.id))})
  GROUP BY t.id
 `);
 return new Map(rows.map(row=>[row.id,row.pending]));
}
