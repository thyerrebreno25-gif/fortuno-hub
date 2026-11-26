import {operationOccurrenceDay,operationWeekend} from "./business-days";
import {operationToday} from "./activity-deadline";
import {routinePriority} from "./routine-policy";
import { operationClientTeam, canonicalTeam } from "./teams";
import { responsibleForProcess } from "./responsible";
import { prisma } from "@/lib/prisma";
import { activityInclude, createEvent } from "@/modules/operations/activity";

type RecurrenceData = {
  interval?: number;
  weekdays?: number[];
  monthDays?: number[];
  startDate?: string;
  endDate?: string | null;
  dueTime?: string;
  dailyMode?: "ALL_DAYS" | "BUSINESS_DAYS" | "CUSTOM_DAYS";
  holidayBehavior?: "KEEP" | "PREVIOUS_BUSINESS_DAY" | "NEXT_BUSINESS_DAY" | "SKIP";
};

const DAY = 86_400_000;
export const startOfDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
export const dateKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}-${String(date.getUTCDate()).padStart(2,"0")}`;
const parseDate = (value?: string | null) => value ? new Date(`${value}T12:00:00Z`) : null;
const addDays = (date: Date, days: number) => { const d=startOfDay(date); d.setUTCDate(d.getUTCDate()+days); return d; };

function withDueTime(date:Date,dueTime?:string){return new Date(dateKey(date)+"T"+(dueTime||"18:00")+":00-03:00");}

async function holidaySet(organizationId: string, from: Date, to: Date) {
  const rows=await prisma.operationHoliday.findMany({where:{organizationId,date:{gte:addDays(from,-370),lte:addDays(to,370)}},select:{date:true}});
  return new Set(rows.map(r=>dateKey(r.date)));
}


export function matchesRecurrence(type: string, data: RecurrenceData | null | undefined, date: Date) {
  if(operationWeekend(dateKey(date)))return false;
  const cfg=data||{}; const current=startOfDay(date); const start=parseDate(cfg.startDate)||current; const end=parseDate(cfg.endDate);
  if(current<startOfDay(start)) return false; if(end&&current>startOfDay(end)) return false;
  if(type==="ONCE") return dateKey(current)===dateKey(start);
  if(type==="DAILY") {
    const mode=cfg.dailyMode||"ALL_DAYS";
    if(mode==="CUSTOM_DAYS" && !(cfg.weekdays||[]).includes(current.getUTCDay())) return false;
    const days=Math.floor((current.getTime()-startOfDay(start).getTime())/DAY);
    return days%Math.max(1,Number(cfg.interval||1))===0;
  }
  if(type==="WEEKLY") {
    const weekdays=cfg.weekdays?.length?cfg.weekdays:[start.getUTCDay()];
    if(!weekdays.includes(current.getUTCDay())) return false;
    const weeks=Math.floor((current.getTime()-startOfDay(start).getTime())/(DAY*7));
    return weeks%Math.max(1,Number(cfg.interval||1))===0;
  }
  if(type==="MONTHLY") {
    const days=cfg.monthDays?.length?cfg.monthDays:[start.getUTCDate()];
    if(!days.includes(current.getUTCDate())) return false;
    const months=(current.getUTCFullYear()-start.getUTCFullYear())*12+current.getUTCMonth()-start.getUTCMonth();
    return months%Math.max(1,Number(cfg.interval||1))===0;
  }
  if(type==="CUSTOM") return (!(cfg.weekdays||[]).length||(cfg.weekdays||[]).includes(current.getUTCDay()))&&(!(cfg.monthDays||[]).length||(cfg.monthDays||[]).includes(current.getUTCDate()));
  return false;
}

function adjustedDate(original:Date,holidays:Set<string>){const day=operationOccurrenceDay(dateKey(original),holidays);return day?new Date(day+"T00:00:00Z"):null;}

export async function generateActivityForConfiguration(configurationId: string, sourceDate: Date, actorUserId?: string, preloadedHolidays?: Set<string>) {
  const configuration=await prisma.operationClientProcess.findUnique({where:{id:configurationId},include:{client:true,process:{include:{checklistTemplates:{orderBy:{position:"asc"}}}},responsible:true}});
  if(!configuration||!configuration.active) return null;
  if(!matchesRecurrence(configuration.recurrenceType,configuration.recurrenceData as RecurrenceData,sourceDate))return null;
  const cfg=(configuration.recurrenceData||{}) as RecurrenceData;
  const holidays=preloadedHolidays||await holidaySet(configuration.client.organizationId,addDays(sourceDate,-10),addDays(sourceDate,10));
  const scheduledDate=adjustedDate(startOfDay(sourceDate),holidays);
  if(!scheduledDate||dateKey(scheduledDate)<operationToday()||(cfg.startDate&&dateKey(scheduledDate)<cfg.startDate)) return null;
  const existing=await prisma.operationActivity.findUnique({where:{clientProcessId_scheduledDate:{clientProcessId:configuration.id,scheduledDate}}});
  if(existing) return prisma.operationActivity.findUnique({where:{id:existing.id},include:activityInclude});

  let activity;
  try {
    activity=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-"+configuration.client.organizationId}))`;
    const live=await tx.operationClientProcess.findFirst({where:{id:configuration.id,active:true,client:{organizationId:configuration.client.organizationId}},select:{id:true,updatedAt:true}});
    if(!live||(configuration.updatedAt&&live.updatedAt?.getTime()!==configuration.updatedAt.getTime()))return null;
    const [{inheritedOwner},{routineClientSuspended}]=await Promise.all([import("./routine-ownership-server"),import("./routine-client-state")]);
    if(await routineClientSuspended(tx,configuration.client.organizationId,configuration.clientId))return null;
    return tx.operationActivity.create({data:{organizationId:configuration.client.organizationId,clientId:configuration.clientId,processId:configuration.processId,clientProcessId:configuration.id,responsibleId:await inheritedOwner(tx,configuration.clientId,configuration.process.name)||configuration.responsibleId || responsibleForProcess(configuration.client, configuration.process),team:operationClientTeam(configuration.client)||canonicalTeam(configuration.team),scheduledDate,title:configuration.process.name,department:configuration.process.department,description:configuration.process.description,dueAt:withDueTime(scheduledDate,cfg.dueTime),legalDate:scheduledDate,competence:`${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth()+1).padStart(2,"0")}`,subjectToFine:configuration.process.subjectToFine,priority:routinePriority(configuration.process.name,configuration.priority) as typeof configuration.priority,clientCluster:configuration.client.cluster,checklistItems:{create:configuration.process.checklistTemplates.map(i=>({templateId:i.id,title:i.title,description:i.description,mandatory:i.mandatory,requiresComment:i.requiresComment,requiresAttachment:i.requiresAttachment,allowedFileTypes:i.allowedFileTypes,allowDisregard:i.allowDisregard,position:i.position}))}},include:activityInclude});
   },{maxWait:10000,timeout:60000});
   if(!activity)return null;
  } catch(error) {
    if((error as {code?:string})?.code!=="P2002") throw error;
    activity=await prisma.operationActivity.findUnique({where:{clientProcessId_scheduledDate:{clientProcessId:configuration.id,scheduledDate}},include:activityInclude});
    if(!activity) throw error;
  }
  const userId=actorUserId||configuration.responsibleId; if(userId) await createEvent(activity.id,userId,"CREATED","Atividade gerada automaticamente pela recorrência.",{configurationId:configuration.id,sourceDate:dateKey(sourceDate),scheduledDate:dateKey(scheduledDate)});
  return activity;
}

export async function generateActivitiesRange(from: Date, to: Date, organizationId?: string, actorUserId?: string) {
  const configurations=await prisma.operationClientProcess.findMany({where:{active:true,...(organizationId?{client:{organizationId}}:{})},select:{id:true,recurrenceType:true,recurrenceData:true,client:{select:{organizationId:true}}}});
  const holidayCache=new Map<string,Set<string>>(); let created=0,skipped=0;
  for(const orgId of new Set(configurations.map(c=>c.client.organizationId))) holidayCache.set(orgId,await holidaySet(orgId,addDays(from,-10),addDays(to,10)));
  for(const c of configurations){ for(let d=startOfDay(from);d<=startOfDay(to);d=addDays(d,1)){ if(!matchesRecurrence(c.recurrenceType,c.recurrenceData as RecurrenceData,d)){skipped++;continue;} const before=await prisma.operationActivity.count({where:{clientProcessId:c.id,scheduledDate:startOfDay(d)}}); const result=await generateActivityForConfiguration(c.id,d,actorUserId,holidayCache.get(c.client.organizationId)); if(result&&!before)created++; else skipped++; } }
  return {created,skipped,from:dateKey(from),to:dateKey(to)};
}

export async function generateFutureActivities(days=90,organizationId?:string,actorUserId?:string){const from=new Date();return generateActivitiesRange(from,addDays(from,Math.max(1,days)),organizationId,actorUserId);}

export async function generateActivitiesForConfigurationRange(configurationId:string,from:Date,to:Date,actorUserId?:string){
  const configuration=await prisma.operationClientProcess.findUnique({where:{id:configurationId},select:{id:true,recurrenceType:true,recurrenceData:true,client:{select:{organizationId:true}}}});
  if(!configuration) return {created:0,skipped:0,from:dateKey(from),to:dateKey(to)};
  const holidays=await holidaySet(configuration.client.organizationId,addDays(from,-10),addDays(to,10));
  let created=0,skipped=0;
  for(let d=startOfDay(from);d<=startOfDay(to);d=addDays(d,1)){
    if(!matchesRecurrence(configuration.recurrenceType,configuration.recurrenceData as RecurrenceData,d)){skipped++;continue;}
    const result=await generateActivityForConfiguration(configuration.id,d,actorUserId,holidays);
    if(result) created++; else skipped++;
  }
  return {created,skipped,from:dateKey(from),to:dateKey(to)};
}
