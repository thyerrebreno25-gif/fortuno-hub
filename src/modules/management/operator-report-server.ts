import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import type {AssistantMember} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {analyticsPeriod,brazilDay,entryAllocation,shiftDay} from "@/modules/operations/analytics";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {whatsappUsage} from "@/modules/whatsapp/usage-server";
import {dailyMeetingTypes} from "@/modules/meetings/daily-model";
import {reportPeriod,type OperatorDayReport,type OperatorDayRow,type ReportKind,type PendingReportWork} from "./operator-report-model";
import {buildServiceSnapshot} from "./service-report-snapshot";
import {operatorServiceAttention} from "./operator-service-attention-server";
import {activityAtDayClose} from "./operator-day-close";
export async function buildOperatorDayReport(member:Pick<AssistantMember,"id"|"organizationId"|"userId"|"role">,day?:string,now=new Date(),kind:ReportKind="GENERAL"):Promise<OperatorDayReport>{
 if(!["MASTER","ADMIN","MANAGER"].includes(member.role))throw new Error("Sem permissão para relatórios da equipe.");
 const period=kind==="SERVICE"?analyticsPeriod(day||brazilDay(now),day||brazilDay(now)):reportPeriod(day,now),org=member.organizationId,permissions=await getRolePermissions(org,member.role);
 if(kind==="SERVICE"&&period.from>brazilDay(now))throw new Error("Selecione uma data até hoje.");
 if(!permissions.MANAGEMENT.canView)throw new Error("Sem permissão para Gestão.");
 const members=await prisma.organizationMember.findMany({where:{organizationId:org,role:kind==="SERVICE"?{not:"CLIENT"}:"OPERATOR",...(member.role==="MANAGER"?{OR:[{userId:member.userId},{teamLeaderId:member.id}]}:{})},select:{userId:true,user:{select:{name:true,email:true,avatar:true}},teamLeader:{select:{user:{select:{name:true,email:true}}}}},orderBy:{user:{name:"asc"}}});
 const rows:OperatorDayRow[]=members.map(person=>({userId:person.userId,name:person.user.name||person.user.email,avatar:person.user.avatar||null,leader:person.teamLeader?.user.name||person.teamLeader?.user.email||null,messages:0,conversations:0,clients:0,resolved:0,openCalls:0,tasksCompleted:0,tasksPending:0,dailyCompleted:0,dailyPending:0,seconds:0,openTimers:0}));
 const index=new Map(rows.map(row=>[row.userId,row])),ids=rows.map(row=>row.userId);
 const available={whatsapp:permissions.WHATSAPP.canView,operations:kind!=="SERVICE"&&permissions.OPERATIONS.canView,daily:kind!=="SERVICE"&&permissions.DAILY_ACTIVITIES.canView},warnings:string[]=[];
 const pendingWork:PendingReportWork[]=[];
 let serviceSnapshot:OperatorDayReport["serviceSnapshot"];
 let serviceAttention:OperatorDayReport["serviceAttention"];
 let meetings:OperatorDayReport["meetings"];
 let feedback:OperatorDayReport["feedback"];
 const feedbackPeriod=kind==="SERVICE"?analyticsPeriod(shiftDay(period.from,-1),shiftDay(period.from,-1)):period;
 await Promise.all([
  (async()=>{if(!available.whatsapp)return;const account=await currentWhatsAppAccount(org);if(!account.accountKey||!account.connection?.phone){available.whatsapp=false;warnings.push("WhatsApp sem conta identificada; indicadores indisponíveis.");return;}
   const recipient=account.accountKey;
   const answers=await prisma.whatsAppSurvey.findMany({where:{organizationId:org,accountRecipient:recipient,operatorId:{in:ids},score:{not:null},answeredAt:{lte:now}},select:{clientName:true,operatorName:true,operatorId:true,score:true,comment:true,answeredAt:true},orderBy:{answeredAt:"desc"}});
   feedback=answers.map(answer=>({client:answer.clientName,operator:answer.operatorName,userId:answer.operatorId,score:answer.score!,comment:answer.comment||"",answeredAt:answer.answeredAt!.toISOString()}));
   const [usage,counts]=await Promise.all([whatsappUsage(org,recipient,account.connection.phone,period.start,period.end),prisma.$queryRaw<Array<{userId:string;resolved:number}>>(Prisma.sql`
    WITH closures AS (SELECT h."userId",COUNT(*)::int AS resolved FROM "ServiceTicketHistory" h JOIN "ServiceTicket" t ON t.id=h."ticketId"
     LEFT JOIN "WhatsAppOperationStart" b ON b."organizationId"=t."organizationId" AND b."accountRecipient"=t."recipientEmail"
     WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."isSpam"=false AND t."mergedIntoId" IS NULL
     AND h.type='WHATSAPP_RESOLVED' AND h."userId" IN (${ids.length?Prisma.join(ids):Prisma.sql`NULL`}) AND h."createdAt">=${period.start} AND h."createdAt"<${period.end}
     AND (b."startedAt" IS NULL OR h."createdAt">=b."startedAt") GROUP BY h."userId") SELECT "userId",resolved FROM closures`)]);
   for(const row of usage.rows){const target=index.get(row.userId);if(target)Object.assign(target,{messages:row.messages,conversations:row.conversations,clients:row.clients});}
   for(const row of counts){const target=index.get(row.userId);if(target)target.resolved=row.resolved;}
   const queueRow:OperatorDayRow={userId:"QUEUE",name:"Fila de atendimento",leader:null,messages:0,conversations:0,clients:0,resolved:0,openCalls:0,tasksCompleted:0,tasksPending:0,dailyCompleted:0,dailyPending:0,seconds:0,openTimers:0};
   const service=await operatorServiceAttention(org,recipient,account.connection.phone,[...rows,queueRow],period,now);
   serviceSnapshot=await buildServiceSnapshot(org,recipient,ids,period,now);serviceAttention=service.attention;
   for(const [id,metrics] of service.metrics){const target=index.get(id);if(target){target.service=metrics;target.openCalls=metrics.openCalls;}}
   if(service.attention.truncated)warnings.push("A análise de atendimento atingiu o limite de consulta; tempos e alertas podem estar parciais.");
  })(),
  (async()=>{if(!available.operations)return;
   const cohort=await prisma.operationActivity.findMany({where:{organizationId:org,createdAt:{lt:period.end},AND:[{OR:[{scheduledDate:{gte:new Date(period.from+"T00:00Z"),lt:new Date(+new Date(period.from+"T00:00Z")+86400000)}},{scheduledDate:null,dueAt:{gte:period.start,lt:period.end}}]},{OR:[{deletedAt:null},{deletedAt:{gte:period.end}}]}]},select:{responsibleId:true,status:true,completedAt:true,deletedAt:true,updatedAt:true,events:{where:{type:{in:["CREATED","ASSIGNED","STARTED","RESUMED","PAUSED","BLOCKED","DISREGARDED","COMPLETED","ACTIVITY_DELETED","STATUS_CHANGED"]}},select:{type:true,message:true,metadata:true,createdAt:true},orderBy:{createdAt:"desc"}}},take:20001});
   if(cohort.length>20000)warnings.push("A programação do dia ultrapassou o limite de consulta; o percentual de execução não foi calculado.");
   else{for(const row of rows)Object.assign(row,{scheduled:0,deliveredScheduled:0,pendingAtClose:0,ignoredScheduled:0,unknownAtClose:0,blockedAtClose:0});for(const activity of cohort){const state=activityAtDayClose(activity,period.end),row=index.get(state.responsibleId||"");if(!row||state.status==="REMOVED")continue;row.scheduled!++;if(state.status==="COMPLETED")row.deliveredScheduled!++;else if(state.status==="DISREGARDED")row.ignoredScheduled!++;else if(state.status==="UNKNOWN")row.unknownAtClose!++;else{row.pendingAtClose!++;if(state.status==="BLOCKED")row.blockedAtClose!++;}}}
   const [completions,pending,entries]=await Promise.all([
    prisma.operationEvent.groupBy({by:["userId","activityId"],where:{type:"COMPLETED",userId:{in:ids},createdAt:{gte:period.start,lt:period.end},activity:{organizationId:org,deletedAt:null}},_count:{_all:true}}),
    prisma.operationActivity.groupBy({by:["responsibleId"],where:{organizationId:org,deletedAt:null,responsibleId:{in:ids},status:{notIn:["COMPLETED","DISREGARDED"]},createdAt:{lt:period.end},OR:[{dueAt:{lt:period.end}},{dueAt:null,scheduledDate:{lt:period.end}},{dueAt:null,scheduledDate:null}]},_count:{_all:true}}),
    prisma.operationTimeEntry.findMany({where:{userId:{in:ids},activity:{organizationId:org,deletedAt:null},startedAt:{lt:period.end},OR:[{endedAt:null},{endedAt:{gte:period.start}}]},select:{userId:true,startedAt:true,endedAt:true,seconds:true,source:true}}),
   ]);
   for(const row of completions){const target=index.get(row.userId);if(target)target.tasksCompleted++;}
   const details=await prisma.operationActivity.findMany({where:{organizationId:org,deletedAt:null,responsibleId:{in:ids},status:{notIn:["COMPLETED","DISREGARDED"]},createdAt:{lt:period.end},OR:[{dueAt:{lt:period.end}},{dueAt:null,scheduledDate:{lt:period.end}},{dueAt:null,scheduledDate:null}]},select:{id:true,title:true,responsibleId:true,dueAt:true,status:true,client:{select:{name:true}}},orderBy:[{dueAt:"asc"},{id:"asc"}],take:1001});
   for(const item of details.slice(0,1000))pendingWork.push({id:item.id,userId:item.responsibleId!,title:item.title,client:item.client.name,dueAt:item.dueAt?.toISOString()||null,status:item.status,kind:"TASK"});
   if(details.length>1000)warnings.push("A lista detalhada de tarefas mostra as primeiras 1.000 pendências; os totais por colaborador incluem todas.");
   for(const row of pending){const target=index.get(row.responsibleId||"");if(target)target.tasksPending=row._count._all;}
   for(const row of entries){const target=index.get(row.userId);if(target){if(!row.endedAt)target.openTimers++;else target.seconds+=entryAllocation(row,period,now).seconds;}}
  })(),
  (async()=>{if(kind==="SERVICE"||!permissions.MEETINGS?.canView)return;
   const items=await prisma.teamMeeting.findMany({where:{organizationId:org,deletedAt:null,startsAt:{gte:period.start,lt:period.end},...(member.role==="MANAGER"?{OR:[{responsibleId:{in:ids}},{participants:{some:{userId:{in:ids}}}}]}:{})},select:{title:true,type:true,startsAt:true,status:true,responsible:{select:{name:true}},participants:{select:{userId:true}},actions:{where:{createdAt:{lt:period.end}},select:{title:true,responsibleId:true,dueAt:true,completedAt:true}}},orderBy:{startsAt:"asc"},take:501});
   meetings=items.slice(0,500).map(item=>({title:item.title,type:item.type,startsAt:item.startsAt.toISOString(),status:item.status,responsible:item.responsible?.name||"Responsável não informado",userIds:item.participants.map(p=>p.userId),actions:item.actions.map(action=>({title:action.title,userId:action.responsibleId,dueAt:action.dueAt.toISOString(),completedAt:action.completedAt?.toISOString()||null}))}));
   if(items.length>500)warnings.push("A seção de reuniões mostra as primeiras 500 reuniões do dia.");
  })(),
  (async()=>{if(!available.daily)return;const scope={responsibleId:{in:ids},meeting:{organizationId:org,deletedAt:null,status:{not:"CANCELLED"},type:{in:dailyMeetingTypes}}};
   const [completed,pending]=await Promise.all([
    prisma.meetingActionItem.groupBy({by:["responsibleId"],where:{...scope,completedAt:{gte:period.start,lt:period.end}},_count:{_all:true}}),
    prisma.meetingActionItem.groupBy({by:["responsibleId"],where:{...scope,completedAt:null,createdAt:{lt:period.end},OR:[{dueAt:{lt:period.end}},{originalDueAt:{lt:period.end}}]},_count:{_all:true}}),
   ]);
   const details=await prisma.meetingActionItem.findMany({where:{...scope,completedAt:null,createdAt:{lt:period.end},OR:[{dueAt:{lt:period.end}},{originalDueAt:{lt:period.end}}]},select:{id:true,title:true,responsibleId:true,dueAt:true,meeting:{select:{title:true}}},orderBy:[{dueAt:"asc"},{id:"asc"}],take:1001});
   for(const item of details.slice(0,1000))pendingWork.push({id:item.id,userId:item.responsibleId,title:item.title,client:item.meeting.title,dueAt:item.dueAt.toISOString(),status:"OPEN",kind:"DAILY"});
   if(details.length>1000)warnings.push("A lista detalhada de Daily mostra as primeiras 1.000 pendências; os totais incluem todas.");
   for(const row of completed){const target=index.get(row.responsibleId);if(target)target.dailyCompleted=row._count._all;}
   for(const row of pending){const target=index.get(row.responsibleId);if(target)target.dailyPending=row._count._all;}
  })(),
 ]);
 return {presentationVersion:2,kind,pendingWork,serviceSnapshot,meetings,feedback,feedbackDay:feedbackPeriod.from,day:period.from,generatedAt:now.toISOString(),scope:member.role==="MANAGER"?"Minha equipe":kind==="SERVICE"?"Equipe de atendimento":"Todos os operadores",available:{...available,...(kind!=="SERVICE"&&permissions.MEETINGS?.canView?{meetings:true}:{})},warnings,rows:rows.sort((a,b)=>b.messages-a.messages||b.tasksCompleted-a.tasksCompleted||a.name.localeCompare(b.name,"pt-BR")),...(serviceAttention?{serviceAttention}:{})};
}
