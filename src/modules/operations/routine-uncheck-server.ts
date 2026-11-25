import "server-only";
import {randomUUID} from "node:crypto";
import {prisma} from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import {canManageOperations,type getOperationMember} from "./auth";
import {OperationTimerError} from "./timer-server";
import {columnsForRoutine,routineColumns} from "./routine-matrix";
import type {ConfiguredRoutine} from "./routine-filters";
import {operationToday} from "./activity-deadline";
import {routineDates,untouchedRoutineActivity} from "./routine-edit-plan";
import type {RoutineEdit} from "./edit-model";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
type Input={clientId:string;columnId:string;routines:{id:string;updatedAt:string}[]};
/** Keep the other weekdays of a combined agenda when a single column is unchecked. */
export function remainingRoutineSchedule(type:string,data:Record<string,unknown>,weekday?:number):Record<string,unknown>|null{
 if(!weekday)return null;
 const days=type==="DAILY"&&data.dailyMode==="BUSINESS_DAYS"?[1,2,3,4,5]:type==="DAILY"&&data.dailyMode!=="CUSTOM_DAYS"?[0,1,2,3,4,5,6]:Array.isArray(data.weekdays)?data.weekdays as number[]:[];
 const remaining=days.filter(day=>day!==weekday);if(!remaining.length)return null;
 return {...data,weekdays:remaining,...(type==="DAILY"?{dailyMode:"CUSTOM_DAYS"}:{})};
}
export async function uncheckRoutineCell(member:Member,input:Input){
 if(!canManageOperations(member.role)||member.canEdit===false)throw new OperationTimerError("Sem permissão para alterar rotinas.",403);
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"operations-reset-"+member.organizationId}))`;
  await tx.$queryRaw`SELECT cp.id FROM "OperationClientProcess" cp JOIN "Client" c ON c.id=cp."clientId" WHERE cp."clientId"=${input.clientId} AND c."organizationId"=${member.organizationId} ORDER BY cp.id FOR UPDATE OF cp`;
  const configurations=await tx.operationClientProcess.findMany({where:{clientId:input.clientId,active:true,client:{organizationId:member.organizationId}},include:{process:{select:{id:true,name:true,department:true}}}});
  const columns=routineColumns(configurations.map(c=>c.process)),column=columns.find(c=>c.id===input.columnId);
  const selected=configurations.filter(c=>columnsForRoutine(c as unknown as ConfiguredRoutine,columns).includes(input.columnId));
  if(!column||!selected.length||selected.length!==input.routines.length||selected.some(c=>!input.routines.some(r=>r.id===c.id&&r.updatedAt===c.updatedAt.toISOString())))throw new OperationTimerError("As rotinas desta célula mudaram. Atualize a tabela antes de desmarcar.",409);
  const today=operationToday(),tomorrow=new Date(+new Date(today+"T00:00:00Z")+86400000),from=tomorrow.toISOString().slice(0,10),now=new Date(),auditId=randomUUID();
  const ids=selected.map(c=>c.id);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "OperationActivity" WHERE "organizationId"=${member.organizationId} AND "clientProcessId" IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
  const activities=await tx.operationActivity.findMany({where:{organizationId:member.organizationId,clientProcessId:{in:ids},deletedAt:null,scheduledDate:{gte:tomorrow}},include:{timeEntries:{select:{id:true}},comments:{select:{id:true}},attachments:{select:{id:true}},checklistItems:{select:{completed:true,disregardedAt:true,comment:true}}},orderBy:{id:"asc"},take:20001});
  if(activities.length>20000)throw new OperationTimerError("Há muitas atividades futuras nesta célula. Reduza a programação antes de desmarcar.",422);
  const horizon=new Date(Math.max(+tomorrow,...activities.map(a=>+(a.scheduledDate||tomorrow)))+10*86400000);
  if(+horizon-+tomorrow>730*86400000)throw new OperationTimerError("A programação excede dois anos. Reduza o período antes de desmarcar.",422);
  const holidays=column.weekday?await tx.operationHoliday.findMany({where:{organizationId:member.organizationId,date:{gte:new Date(+tomorrow-370*86400000),lte:new Date(+horizon+370*86400000)}},select:{date:true}}):[];
  const holidaySet=new Set(holidays.map(h=>h.date.toISOString().slice(0,10))),remove:string[]=[],before:Prisma.InputJsonValue[]=[];let preserved=0;
  for(const configuration of selected){
   const data=(configuration.recurrenceData||{}) as Record<string,unknown>,remaining=remainingRoutineSchedule(configuration.recurrenceType,data,column.weekday);
   const keepDates=remaining?routineDates({recurrenceType:configuration.recurrenceType,recurrenceData:{...remaining,dueTime:remaining.dueTime||"18:00",holidayBehavior:remaining.holidayBehavior||"KEEP"}} as RoutineEdit,from,horizon.toISOString().slice(0,10),holidaySet):null;
   before.push({id:configuration.id,recurrenceType:configuration.recurrenceType,recurrenceData:configuration.recurrenceData as Prisma.InputJsonValue,active:true});
   await tx.operationClientProcess.update({where:{id:configuration.id},data:remaining?{recurrenceData:remaining as Prisma.InputJsonValue}:{active:false}});
   for(const activity of activities.filter(a=>a.clientProcessId===configuration.id)){
    if(!activity.scheduledDate||activity.scheduledDate.toISOString().slice(0,10)<=today){preserved++;continue;}
    if(keepDates?.has(activity.scheduledDate!.toISOString().slice(0,10)))continue;
    if(!untouchedRoutineActivity(activity)||(activity.dueAt&&operationToday(activity.dueAt)<=today)){preserved++;continue;}
    remove.push(activity.id);
   }
  }
  for(let offset=0;offset<remove.length;offset+=500){const batch=remove.slice(offset,offset+500);const changed=await tx.operationActivity.updateMany({where:{id:{in:batch},organizationId:member.organizationId,deletedAt:null},data:{deletedAt:now,deletedById:member.userId,deletionReason:`Rotina desmarcada: ${auditId}`}});if(changed.count!==batch.length)throw new OperationTimerError("As atividades mudaram durante a alteração. Atualize a tabela.",409);}
  await tx.auditLog.create({data:{id:auditId,userId:member.userId,entity:"OperationClientProcess",entityId:input.clientId,action:"ROUTINE_CELL_UNCHECKED",beforeData:{configurations:before,activityIds:remove},afterData:{organizationId:member.organizationId,columnId:input.columnId,removed:remove.length,preserved,preserveThrough:today}}});
  return {removed:remove.length,preserved};
 },{maxWait:10000,timeout:50000});
}
