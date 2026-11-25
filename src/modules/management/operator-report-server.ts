import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import type {AssistantMember} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {entryAllocation} from "@/modules/operations/analytics";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {whatsappUsage} from "@/modules/whatsapp/usage-server";
import {dailyMeetingTypes} from "@/modules/meetings/daily-model";
import {reportPeriod,type OperatorDayReport,type OperatorDayRow} from "./operator-report-model";
import {operatorServiceAttention} from "./operator-service-attention-server";
export async function buildOperatorDayReport(member:Pick<AssistantMember,"id"|"organizationId"|"userId"|"role">,day?:string,now=new Date()):Promise<OperatorDayReport>{
 if(!["MASTER","ADMIN","MANAGER"].includes(member.role))throw new Error("Sem permissão para relatórios da equipe.");
 const period=reportPeriod(day,now),org=member.organizationId,permissions=await getRolePermissions(org,member.role);
 if(!permissions.MANAGEMENT.canView)throw new Error("Sem permissão para Gestão.");
 const members=await prisma.organizationMember.findMany({where:{organizationId:org,role:"OPERATOR",...(member.role==="MANAGER"?{OR:[{userId:member.userId},{teamLeaderId:member.id}]}:{})},select:{userId:true,user:{select:{name:true,email:true}},teamLeader:{select:{user:{select:{name:true,email:true}}}}},orderBy:{user:{name:"asc"}}});
 const rows:OperatorDayRow[]=members.map(person=>({userId:person.userId,name:person.user.name||person.user.email,leader:person.teamLeader?.user.name||person.teamLeader?.user.email||null,messages:0,conversations:0,clients:0,resolved:0,openCalls:0,tasksCompleted:0,tasksPending:0,dailyCompleted:0,dailyPending:0,seconds:0,openTimers:0}));
 const index=new Map(rows.map(row=>[row.userId,row])),ids=rows.map(row=>row.userId);
 const available={whatsapp:permissions.WHATSAPP.canView,operations:permissions.OPERATIONS.canView,daily:permissions.DAILY_ACTIVITIES.canView},warnings:string[]=[];
 let serviceAttention:OperatorDayReport["serviceAttention"];
 if(ids.length)await Promise.all([
  (async()=>{if(!available.whatsapp)return;const account=await currentWhatsAppAccount(org);if(!account.accountKey||!account.connection?.phone){available.whatsapp=false;warnings.push("WhatsApp sem conta identificada; indicadores indisponíveis.");return;}
   const recipient=account.accountKey;
   const [usage,counts]=await Promise.all([whatsappUsage(org,recipient,account.connection.phone,period.start,period.end),prisma.$queryRaw<Array<{userId:string;resolved:number}>>(Prisma.sql`
    WITH closures AS (SELECT h."userId",COUNT(*)::int AS resolved FROM "ServiceTicketHistory" h JOIN "ServiceTicket" t ON t.id=h."ticketId"
     LEFT JOIN "WhatsAppOperationStart" b ON b."organizationId"=t."organizationId" AND b."accountRecipient"=t."recipientEmail"
     WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."isSpam"=false AND t."mergedIntoId" IS NULL
     AND h.type='WHATSAPP_RESOLVED' AND h."userId" IN (${Prisma.join(ids)}) AND h."createdAt">=${period.start} AND h."createdAt"<${period.end}
     AND (b."startedAt" IS NULL OR h."createdAt">=b."startedAt") GROUP BY h."userId") SELECT "userId",resolved FROM closures`)]);
   for(const row of usage.rows){const target=index.get(row.userId);if(target)Object.assign(target,{messages:row.messages,conversations:row.conversations,clients:row.clients});}
   for(const row of counts){const target=index.get(row.userId);if(target)target.resolved=row.resolved;}
   const service=await operatorServiceAttention(org,recipient,account.connection.phone,rows,period,now);serviceAttention=service.attention;
   for(const [id,metrics] of service.metrics){const target=index.get(id);if(target){target.service=metrics;target.openCalls=metrics.openCalls;}}
   if(service.attention.truncated)warnings.push("A análise de atendimento atingiu o limite de consulta; tempos e alertas podem estar parciais.");
  })(),
  (async()=>{if(!available.operations)return;
   const [completions,pending,entries]=await Promise.all([
    prisma.operationEvent.groupBy({by:["userId","activityId"],where:{type:"COMPLETED",userId:{in:ids},createdAt:{gte:period.start,lt:period.end},activity:{organizationId:org,deletedAt:null}},_count:{_all:true}}),
    prisma.operationActivity.groupBy({by:["responsibleId"],where:{organizationId:org,deletedAt:null,responsibleId:{in:ids},status:{notIn:["COMPLETED","DISREGARDED"]},createdAt:{lt:period.end},OR:[{dueAt:{lt:period.end}},{dueAt:null,scheduledDate:{lt:period.end}},{dueAt:null,scheduledDate:null}]},_count:{_all:true}}),
    prisma.operationTimeEntry.findMany({where:{userId:{in:ids},activity:{organizationId:org,deletedAt:null},startedAt:{lt:period.end},OR:[{endedAt:null},{endedAt:{gte:period.start}}]},select:{userId:true,startedAt:true,endedAt:true,seconds:true,source:true}}),
   ]);
   for(const row of completions){const target=index.get(row.userId);if(target)target.tasksCompleted++;}
   for(const row of pending){const target=index.get(row.responsibleId||"");if(target)target.tasksPending=row._count._all;}
   for(const row of entries){const target=index.get(row.userId);if(target){if(!row.endedAt)target.openTimers++;else target.seconds+=entryAllocation(row,period,now).seconds;}}
  })(),
  (async()=>{if(!available.daily)return;const scope={responsibleId:{in:ids},meeting:{organizationId:org,deletedAt:null,status:{not:"CANCELLED"},type:{in:dailyMeetingTypes}}};
   const [completed,pending]=await Promise.all([
    prisma.meetingActionItem.groupBy({by:["responsibleId"],where:{...scope,completedAt:{gte:period.start,lt:period.end}},_count:{_all:true}}),
    prisma.meetingActionItem.groupBy({by:["responsibleId"],where:{...scope,completedAt:null,createdAt:{lt:period.end},OR:[{dueAt:{lt:period.end}},{originalDueAt:{lt:period.end}}]},_count:{_all:true}}),
   ]);
   for(const row of completed){const target=index.get(row.responsibleId);if(target)target.dailyCompleted=row._count._all;}
   for(const row of pending){const target=index.get(row.responsibleId);if(target)target.dailyPending=row._count._all;}
  })(),
 ]);
 return {day:period.from,generatedAt:now.toISOString(),scope:member.role==="MANAGER"?"Minha equipe":"Todos os operadores",available,warnings,rows:rows.sort((a,b)=>b.messages-a.messages||b.tasksCompleted-a.tasksCompleted||a.name.localeCompare(b.name,"pt-BR")),...(serviceAttention?{serviceAttention}:{})};
}
