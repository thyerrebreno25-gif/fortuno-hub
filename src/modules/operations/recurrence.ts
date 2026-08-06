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
export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const parseDate = (value?: string | null) => value ? new Date(`${value}T12:00:00`) : null;
const addDays = (date: Date, days: number) => { const d=startOfDay(date); d.setDate(d.getDate()+days); return d; };
const isWeekend = (date: Date) => date.getDay()===0 || date.getDay()===6;

function withDueTime(date: Date, dueTime?: string) {
  const result=startOfDay(date); const [h,m]=String(dueTime||"18:00").split(":").map(Number);
  result.setHours(Number.isFinite(h)?h:18,Number.isFinite(m)?m:0,0,0); return result;
}

async function holidaySet(organizationId: string, from: Date, to: Date) {
  const rows=await prisma.operationHoliday.findMany({where:{organizationId,date:{gte:startOfDay(from),lte:startOfDay(to)}},select:{date:true}});
  return new Set(rows.map(r=>dateKey(r.date)));
}

function isBusinessDay(date: Date, holidays: Set<string>) { return !isWeekend(date) && !holidays.has(dateKey(date)); }

export function matchesRecurrence(type: string, data: RecurrenceData | null | undefined, date: Date) {
  const cfg=data||{}; const current=startOfDay(date); const start=parseDate(cfg.startDate)||current; const end=parseDate(cfg.endDate);
  if(current<startOfDay(start)) return false; if(end&&current>startOfDay(end)) return false;
  if(type==="ONCE") return dateKey(current)===dateKey(start);
  if(type==="DAILY") {
    const mode=cfg.dailyMode||"ALL_DAYS";
    if(mode==="BUSINESS_DAYS" && isWeekend(current)) return false;
    if(mode==="CUSTOM_DAYS" && !(cfg.weekdays||[]).includes(current.getDay())) return false;
    const days=Math.floor((current.getTime()-startOfDay(start).getTime())/DAY);
    return days%Math.max(1,Number(cfg.interval||1))===0;
  }
  if(type==="WEEKLY") {
    const weekdays=cfg.weekdays?.length?cfg.weekdays:[start.getDay()];
    if(!weekdays.includes(current.getDay())) return false;
    const weeks=Math.floor((current.getTime()-startOfDay(start).getTime())/(DAY*7));
    return weeks%Math.max(1,Number(cfg.interval||1))===0;
  }
  if(type==="MONTHLY") {
    const days=cfg.monthDays?.length?cfg.monthDays:[start.getDate()];
    if(!days.includes(current.getDate())) return false;
    const months=(current.getFullYear()-start.getFullYear())*12+current.getMonth()-start.getMonth();
    return months%Math.max(1,Number(cfg.interval||1))===0;
  }
  if(type==="CUSTOM") return (!(cfg.weekdays||[]).length||(cfg.weekdays||[]).includes(current.getDay()))&&(!(cfg.monthDays||[]).length||(cfg.monthDays||[]).includes(current.getDate()));
  return false;
}

async function adjustedDate(original: Date, organizationId: string, cfg: RecurrenceData, holidays: Set<string>) {
  const behavior=cfg.holidayBehavior||"KEEP";
  if(!holidays.has(dateKey(original)) || behavior==="KEEP") return original;
  if(behavior==="SKIP") return null;
  const direction=behavior==="PREVIOUS_BUSINESS_DAY"?-1:1;
  let candidate=original;
  for(let i=0;i<10;i++){ candidate=addDays(candidate,direction); if(isBusinessDay(candidate,holidays)) return candidate; }
  return null;
}

export async function generateActivityForConfiguration(configurationId: string, sourceDate: Date, actorUserId?: string, preloadedHolidays?: Set<string>) {
  const configuration=await prisma.operationClientProcess.findUnique({where:{id:configurationId},include:{client:true,process:{include:{checklistTemplates:{orderBy:{position:"asc"}}}},responsible:true}});
  if(!configuration||!configuration.active) return null;
  const cfg=(configuration.recurrenceData||{}) as RecurrenceData;
  const holidays=preloadedHolidays||await holidaySet(configuration.client.organizationId,addDays(sourceDate,-10),addDays(sourceDate,10));
  const scheduledDate=await adjustedDate(startOfDay(sourceDate),configuration.client.organizationId,cfg,holidays);
  if(!scheduledDate) return null;
  const existing=await prisma.operationActivity.findUnique({where:{clientProcessId_scheduledDate:{clientProcessId:configuration.id,scheduledDate}}});
  if(existing) return prisma.operationActivity.findUnique({where:{id:existing.id},include:activityInclude});

  let activity;
  try {
    activity=await prisma.operationActivity.create({data:{organizationId:configuration.client.organizationId,clientId:configuration.clientId,processId:configuration.processId,clientProcessId:configuration.id,responsibleId:configuration.responsibleId,team:configuration.team,scheduledDate,title:configuration.process.name,department:configuration.process.department,description:configuration.process.description,dueAt:withDueTime(scheduledDate,cfg.dueTime),legalDate:scheduledDate,competence:`${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth()+1).padStart(2,"0")}`,subjectToFine:configuration.process.subjectToFine,priority:configuration.priority,clientCluster:configuration.client.cluster,checklistItems:{create:configuration.process.checklistTemplates.map(i=>({templateId:i.id,title:i.title,description:i.description,mandatory:i.mandatory,requiresComment:i.requiresComment,requiresAttachment:i.requiresAttachment,allowedFileTypes:i.allowedFileTypes,allowDisregard:i.allowDisregard,position:i.position}))}},include:activityInclude});
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
