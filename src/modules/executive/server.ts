import { onboardingSummary } from "./onboarding";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ExecutiveData, ExecutivePeriod } from "./types";
import { executivePeriod } from "./model";
export type ExecutiveScope=ExecutiveData["available"] & {finance:boolean;purchase:boolean;investment:boolean;contract:boolean;calendar:boolean};
type Row=Record<string,string|number|bigint|null>;
const n=(value:unknown)=>Number(value||0);
export async function executiveSnapshot(organizationId:string,key:ExecutivePeriod,scope:ExecutiveScope):Promise<ExecutiveData>{
 const now=new Date(),period=executivePeriod(key,now),{start,end}=period;
 const today=executivePeriod("today",now),horizon=new Date(now.getTime()+7*86400000);
 const sources=[...(scope.whatsapp?["WHATSAPP_API"]:[]),...(scope.email?["GMAIL","MANUAL"]:[])];
 const org=organizationId;
 const [clients,tickets,health,people,activityGroups,overdueGroups,completedGroups,scheduled,running,operationDaily,support,meetings,meetingCounts,personal,personalGroups,meetingGroups,personalToday,ca,onboardings]=await Promise.all([
  scope.clients?prisma.client.groupBy({by:["active"],where:{organizationId:org},_count:{_all:true}}):[],
  sources.length?prisma.$queryRaw<Row[]>(Prisma.sql`
   SELECT CASE WHEN "source"='WHATSAPP_API' THEN 'whatsapp' ELSE 'email' END AS channel,"assignedToId" AS person,
    COUNT(*) FILTER(WHERE NOT "isSpam" AND "status" NOT IN ('SPAM','RESOLVED')) AS open,
    COUNT(*) FILTER(WHERE NOT "isSpam" AND "status"='IN_PROGRESS') AS progress,
    COUNT(*) FILTER(WHERE NOT "isSpam" AND "status"='RESOLVED' AND "resolvedAt">=${start} AND "resolvedAt"<${end}) AS resolved,
    COUNT(*) FILTER(WHERE NOT "isSpam" AND "status"<>'SPAM' AND "receivedAt">=${start} AND "receivedAt"<${end}) AS received,
    COUNT(*) FILTER(WHERE ("isSpam" OR "status"='SPAM') AND "receivedAt">=${start} AND "receivedAt"<${end}) AS spam,
    SUM(EXTRACT(EPOCH FROM ("resolvedAt"-operational_in.at))/60) FILTER(WHERE NOT "isSpam" AND "status"='RESOLVED' AND "resolvedAt">=${start} AND "resolvedAt"<${end} AND "resolvedAt">=operational_in.at) AS duration,
    COUNT(*) FILTER(WHERE NOT "isSpam" AND "status"='RESOLVED' AND "resolvedAt">=${start} AND "resolvedAt"<${end} AND "resolvedAt">=operational_in.at) AS sample,
    SUM(EXTRACT(EPOCH FROM (operational_out.at-operational_in.at))/60) FILTER(WHERE NOT "isSpam" AND status<>'SPAM' AND operational_out.at>=${start} AND operational_out.at<${end}) AS response,
    COUNT(*) FILTER(WHERE NOT "isSpam" AND status<>'SPAM' AND operational_out.at>=${start} AND operational_out.at<${end}) AS response_sample
   FROM "ServiceTicket"
   LEFT JOIN LATERAL (SELECT MIN(m."receivedAt") at FROM "ServiceMessage" m WHERE m."ticketId"="ServiceTicket".id AND m.direction='INBOUND' AND m."providerMetadata"->>'historical'='false') operational_in ON source='WHATSAPP_API'
   LEFT JOIN LATERAL (SELECT MIN(m."receivedAt") at FROM "ServiceMessage" m WHERE m."ticketId"="ServiceTicket".id AND m.direction='OUTBOUND' AND COALESCE(m."providerMetadata"->>'historical','false')<>'true' AND m."receivedAt">=operational_in.at) operational_out ON source='WHATSAPP_API'
   WHERE "organizationId"=${org} AND "mergedIntoId" IS NULL AND "source" IN (${Prisma.join(sources)}) AND (source<>'WHATSAPP_API' OR EXISTS(SELECT 1 FROM "ServiceMessage" seen WHERE seen."ticketId"="ServiceTicket".id)) GROUP BY channel,"assignedToId"`):[],
  scope.whatsapp?prisma.$queryRaw<Row[]>(Prisma.sql`
   SELECT COUNT(*) AS waiting,COUNT(*) FILTER(WHERE age<=15) AS ontime,COUNT(*) FILTER(WHERE age>15 AND age<=30) AS delayed,COUNT(*) FILTER(WHERE age>30) AS critical,MAX(age) AS oldest FROM (
    SELECT EXTRACT(EPOCH FROM (${now}::timestamptz-last_in.at))/60 AS age
    FROM "ServiceTicket" t
    LEFT JOIN LATERAL (SELECT MAX(m."receivedAt") at FROM "ServiceMessage" m WHERE m."ticketId"=t.id AND m.direction='OUTBOUND') last_out ON TRUE
    JOIN LATERAL (SELECT MIN(m."receivedAt") at FROM "ServiceMessage" m WHERE m."ticketId"=t.id AND m.direction='INBOUND' AND m."providerMetadata"->>'historical'='false' AND (last_out.at IS NULL OR m."receivedAt">last_out.at)) last_in ON last_in.at IS NOT NULL
    WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."mergedIntoId" IS NULL AND NOT t."isSpam" AND t.status NOT IN ('SPAM','RESOLVED') AND (last_out.at IS NULL OR last_in.at>last_out.at) AND last_in.at<=${now}
   ) waiting_messages`):[],
  prisma.organizationMember.findMany({where:{organizationId:org,role:{not:"CLIENT"}},select:{user:{select:{id:true,name:true}}},orderBy:{createdAt:"asc"}}),
  scope.operations?prisma.operationActivity.groupBy({by:["responsibleId","status"],where:{organizationId:org,deletedAt:null,status:{in:["OPEN","IN_PROGRESS","BLOCKED"]}},_count:{_all:true}}):[],
  scope.operations?prisma.operationActivity.groupBy({by:["responsibleId"],where:{organizationId:org,deletedAt:null,status:{in:["OPEN","IN_PROGRESS","BLOCKED"]},dueAt:{lt:now}},_count:{_all:true}}):[],
  scope.operations?prisma.operationActivity.groupBy({by:["responsibleId"],where:{organizationId:org,deletedAt:null,status:"COMPLETED",completedAt:{gte:start,lt:end}},_count:{_all:true}}):[],
  scope.operations?prisma.operationActivity.count({where:{organizationId:org,deletedAt:null,scheduledDate:{gte:new Date(period.from+"T00:00:00Z"),lt:new Date(period.to+"T23:59:59.999Z")}}}):0,
  scope.operations?prisma.operationTimeEntry.count({where:{endedAt:null,activity:{organizationId:org,deletedAt:null}}}):0,
  scope.operations?prisma.$queryRaw<Row[]>(Prisma.sql`SELECT to_char("completedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date,COUNT(*) AS count FROM "OperationActivity" WHERE "organizationId"=${org} AND "deletedAt" IS NULL AND status='COMPLETED' AND "completedAt">=${start} AND "completedAt"<${end} GROUP BY date`):[],
  scope.support?prisma.$queryRaw<Row[]>(Prisma.sql`SELECT COUNT(*) FILTER(WHERE status IN ('OPEN','IN_PROGRESS')) AS open,COUNT(*) FILTER(WHERE status='IN_PROGRESS') AS progress,COUNT(*) FILTER(WHERE status IN ('RESOLVED','CLOSED') AND "updatedAt">=${start} AND "updatedAt"<${end}) AS resolved,COUNT(*) FILTER(WHERE "createdAt">=${start} AND "createdAt"<${end}) AS received FROM "SupportTicket" WHERE "organizationId"=${org}`):[],
  scope.meetings?prisma.teamMeeting.findMany({where:{organizationId:org,deletedAt:null,status:{not:"CANCELLED"},endsAt:{gte:now},startsAt:{lte:horizon}},select:{id:true,title:true,startsAt:true,endsAt:true,status:true,participants:{select:{userId:true,user:{select:{name:true}}}}},orderBy:{startsAt:"asc"},take:200}):[],
  scope.meetings?prisma.$queryRaw<Row[]>(Prisma.sql`SELECT COUNT(*) FILTER(WHERE "startsAt">=${today.start} AND "startsAt"<${today.end}) AS today,COUNT(*) FILTER(WHERE "endsAt">=${now} AND "startsAt"<=${horizon}) AS upcoming,COUNT(*) FILTER(WHERE status='COMPLETED' AND "endsAt">=${start} AND "endsAt"<${end}) AS completed FROM "TeamMeeting" WHERE "organizationId"=${org} AND "deletedAt" IS NULL AND status<>'CANCELLED'`):[],
  scope.calendar?prisma.teamCalendarEvent.findMany({where:{organizationId:org,status:"ACTIVE",meetingId:null,actionItemId:null,endsAt:{gte:now},startsAt:{lte:horizon}},select:{id:true,title:true,startsAt:true,endsAt:true,userId:true,user:{select:{name:true}}},orderBy:{startsAt:"asc"},take:200}):[],
  scope.calendar?prisma.teamCalendarEvent.groupBy({by:["userId"],where:{organizationId:org,status:"ACTIVE",meetingId:null,actionItemId:null,endsAt:{gte:now},startsAt:{lte:horizon}},_count:{_all:true}}):[],
  scope.meetings?prisma.$queryRaw<Row[]>(Prisma.sql`SELECT p."userId" AS person,COUNT(*) AS count FROM "MeetingParticipant" p JOIN "TeamMeeting" m ON m.id=p."meetingId" WHERE m."organizationId"=${org} AND m."deletedAt" IS NULL AND m.status<>'CANCELLED' AND m."endsAt">=${now} AND m."startsAt"<=${horizon} GROUP BY p."userId"`):[],
  scope.calendar?prisma.teamCalendarEvent.count({where:{organizationId:org,status:"ACTIVE",meetingId:null,actionItemId:null,startsAt:{gte:today.start,lt:today.end}}}):0,
  scope.ca?caMetrics(org,start,end,scope):[],
  scope.onboarding?prisma.onboarding.findMany({where:{organizationId:org,status:{not:"CANCELLED"}},select:{id:true,status:true,risk:true,expectedEndDate:true,completedAt:true,companyName:true,responsibleName:true,client:{select:{name:true}},responsible:{select:{name:true}},projectData:true,tasks:{select:{status:true}}}}):[],
 ]);
 const result:ExecutiveData={generatedAt:now.toISOString(),period:{key,label:period.label,from:period.from,to:period.to},available:{...scope,meetings:scope.meetings||scope.calendar},
 onboarding:onboardingSummary(onboardings,start,end,now),
 clients:{active:clients.filter(row=>row.active).reduce((s,r)=>s+r._count._all,0),total:clients.reduce((s,r)=>s+r._count._all,0)},
 whatsapp:{open:0,unassigned:0,inProgress:0,resolvedPeriod:0,receivedPeriod:0,averageResolutionMinutes:null,resolutionSample:0,health:{targetMinutes:15,waiting:n(health[0]?.waiting),onTime:n(health[0]?.ontime),delayed:n(health[0]?.delayed),critical:n(health[0]?.critical),oldestWaitingMinutes:health[0]?.oldest==null?null:n(health[0].oldest),averageFirstResponseMinutes:null,firstResponseSample:0}},
 email:{open:0,unassigned:0,resolvedPeriod:0,spamPeriod:0,receivedPeriod:0},support:{open:n(support[0]?.open),inProgress:n(support[0]?.progress),resolvedPeriod:n(support[0]?.resolved),receivedPeriod:n(support[0]?.received)},
 operations:{open:activityGroups.reduce((s,r)=>s+r._count._all,0),overdue:overdueGroups.reduce((s,r)=>s+r._count._all,0),completedPeriod:completedGroups.reduce((s,r)=>s+r._count._all,0),scheduledPeriod:scheduled,runningTimers:running},
 meetings:{today:n(meetingCounts[0]?.today)+personalToday,upcoming:n(meetingCounts[0]?.upcoming)+personalGroups.reduce((s,r)=>s+r._count._all,0),completedPeriod:n(meetingCounts[0]?.completed),agenda:[...meetings.map(m=>({id:m.id,title:m.title,startsAt:m.startsAt.toISOString(),endsAt:m.endsAt.toISOString(),status:m.status,participants:m.participants.map(p=>p.user.name||"Colaborador")})),...personal.map(m=>({id:"calendar:"+m.id,title:m.title,startsAt:m.startsAt.toISOString(),endsAt:m.endsAt.toISOString(),status:"AGENDA",participants:[m.user.name||"Colaborador"]}))].sort((a,b)=>a.startsAt.localeCompare(b.startsAt))},
 ca:{confirmedLines:0,failedLines:0,pendingLines:0,confirmedBatches:0,breakdown:[]},
 operators:people.map(p=>({id:p.user.id,name:p.user.name||"Colaborador",whatsappOpen:0,emailOpen:0,activitiesOpen:0,activitiesOverdue:0,completedPeriod:0,meetingsUpcoming:0})),daily:period.days.map(day=>({date:day.date,whatsappReceived:0,emailReceived:0,activitiesCompleted:0,caConfirmed:0})),notes:["Contatos do WhatsApp sem mensagens não são contados como atendimentos.","Fila e pendências mostram a situação atual; recebidos e concluídos respeitam o período selecionado.","Agendas incluem reuniões e compromissos registrados no Hub; não representam todos os eventos externos do Google.","Tempos do WhatsApp usam entradas operacionais identificadas, em tempo corrido. Histórico recuperado não entra no SLA. A espera começa na primeira mensagem ainda sem resposta após a última saída; mensagens adicionais não reiniciam o prazo.","Envios ao CA são registros confirmados, não chamadas da API. Criação e baixa do mesmo lançamento contam uma única vez."]};
 if(scope.onboarding)result.notes.push("Onboarding: pendências e riscos são das implantações abertas; conclusões usam completedAt no período. Atraso: entrega anterior ao dia atual. Atenção: bloqueio, espera pelo cliente, risco registrado ou entrega em até 3 dias. Progresso usa os pesos das etapas atuais; tarefas do formato anterior são contadas apenas sem etapas no projeto.");
 const operators=new Map(result.operators.map(row=>[row.id,row]));let duration=0,response=0;
 for(const row of tickets){if(row.channel==="whatsapp"){const w=result.whatsapp;w.open+=n(row.open);w.inProgress+=n(row.progress);w.resolvedPeriod+=n(row.resolved);w.receivedPeriod+=n(row.received);w.resolutionSample+=n(row.sample);w.health.firstResponseSample+=n(row.response_sample);duration+=n(row.duration);response+=n(row.response);if(!row.person)w.unassigned+=n(row.open);if(row.person&&operators.has(String(row.person)))operators.get(String(row.person))!.whatsappOpen+=n(row.open);}else{const e=result.email;e.open+=n(row.open);e.resolvedPeriod+=n(row.resolved);e.receivedPeriod+=n(row.received);e.spamPeriod+=n(row.spam);if(!row.person)e.unassigned+=n(row.open);if(row.person&&operators.has(String(row.person)))operators.get(String(row.person))!.emailOpen+=n(row.open);}}
 if(result.whatsapp.resolutionSample)result.whatsapp.averageResolutionMinutes=duration/result.whatsapp.resolutionSample;
 if(result.whatsapp.health.firstResponseSample)result.whatsapp.health.averageFirstResponseMinutes=response/result.whatsapp.health.firstResponseSample;
 for(const row of activityGroups)if(row.responsibleId&&operators.has(row.responsibleId))operators.get(row.responsibleId)!.activitiesOpen+=row._count._all;
 for(const row of overdueGroups)if(row.responsibleId&&operators.has(row.responsibleId))operators.get(row.responsibleId)!.activitiesOverdue+=row._count._all;
 for(const row of completedGroups)if(row.responsibleId&&operators.has(row.responsibleId))operators.get(row.responsibleId)!.completedPeriod+=row._count._all;
 for(const row of meetingGroups)if(operators.has(String(row.person)))operators.get(String(row.person))!.meetingsUpcoming+=n(row.count);
 for(const row of personalGroups)if(operators.has(row.userId))operators.get(row.userId)!.meetingsUpcoming+=row._count._all;
 if(meetings.length===200||personal.length===200)result.notes.push("A lista de agenda exibe até 200 reuniões e 200 compromissos; os totais gerais não são truncados.");
 if(scope.ca)result.notes.push("Faturas/adquirentes usam a confirmação registrada. Rendimentos e contratos usam a última atualização do registro confirmado; uma reconferência pode aparecer no período.");
 if(scope.support)result.notes.push("Chamados de suporte concluídos usam a última atualização, pois esse módulo não registra uma data de resolução separada.");
 const days=new Map(result.daily.map(row=>[row.date,row]));for(const row of operationDaily)if(days.has(String(row.date)))days.get(String(row.date))!.activitiesCompleted=n(row.count);
 const serviceDaily=sources.length?await prisma.$queryRaw<Row[]>(Prisma.sql`SELECT to_char("receivedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date,CASE WHEN source='WHATSAPP_API' THEN 'whatsapp' ELSE 'email' END AS channel,COUNT(*) AS count FROM "ServiceTicket" WHERE "organizationId"=${org} AND "mergedIntoId" IS NULL AND NOT "isSpam" AND status<>'SPAM' AND source IN (${Prisma.join(sources)}) AND (source<>'WHATSAPP_API' OR EXISTS(SELECT 1 FROM "ServiceMessage" seen WHERE seen."ticketId"="ServiceTicket".id)) AND "receivedAt">=${start} AND "receivedAt"<${end} GROUP BY date,channel`):[];
 for(const row of serviceDaily){const day=days.get(String(row.date));if(day){if(row.channel==="whatsapp")day.whatsappReceived+=n(row.count);else day.emailReceived+=n(row.count);}}
 for(const row of ca){if(row.date){const day=days.get(String(row.date));if(day)day.caConfirmed+=n(row.confirmed);continue;}result.ca.confirmedLines+=n(row.confirmed);result.ca.failedLines+=n(row.failed);result.ca.pendingLines+=n(row.pending);result.ca.confirmedBatches+=n(row.batches);result.ca.breakdown!.push({label:({CREDIT_CARD_INVOICE:"Faturas",ACQUIRER:"Adquirentes",INVESTMENT:"Rendimentos",CONTRACT:"Contratos",PURCHASE:"Notas de compra"} as Record<string,string>)[String(row.label)]||String(row.label),confirmed:n(row.confirmed)});}
 return result;
}
async function caMetrics(org:string,start:Date,end:Date,scope:ExecutiveScope){
 const pieces:Prisma.Sql[]=[];
 if(scope.finance)pieces.push(Prisma.sql`SELECT e.module::text AS label,'financial:'||e.id AS batch,l.status='SETTLED' OR NULLIF(l.metadata->>'creationConfirmedAt','') IS NOT NULL AS confirmed,l.status='FAILED' AS failed,l.status IN ('PENDING','CREATED') AS pending,COALESCE(NULLIF(l.metadata->>'creationConfirmedAt','')::timestamp,l."updatedAt") AS at FROM "ContaAzulFinancialExportLine" l JOIN "ContaAzulFinancialExport" e ON e.id=l."exportId" WHERE e."organizationId"=${org}`);
 const kinds=[...(scope.investment?["INVESTMENT"]:[]),...(scope.contract?["CONTRACT"]:[])];
 if(kinds.length)pieces.push(Prisma.sql`SELECT r.kind AS label,'document:'||d."reviewId" AS batch,d.status='SENT' AS confirmed,d.status='FAILED' AS failed,d.status NOT IN ('SENT','FAILED','MISSING_CA') AS pending,d."updatedAt" AS at FROM "DocumentImportDelivery" d JOIN "DocumentImportReview" r ON r.id=d."reviewId" WHERE d."organizationId"=${org} AND r."organizationId"=${org} AND r.kind IN (${Prisma.join(kinds)})`);
 if(scope.purchase)pieces.push(Prisma.sql`SELECT 'PURCHASE' AS label,'purchase:'||id AS batch,status='SENT' AND "sentAt" IS NOT NULL AS confirmed,status='FAILED' AS failed,status='READY_TO_SEND' AS pending,COALESCE("sentAt","updatedAt") AS at FROM "PurchaseInvoice" WHERE "organizationId"=${org} AND source='XML_UPLOAD'`);
 if(!pieces.length)return [];
 return prisma.$queryRaw<Row[]>(Prisma.sql`WITH records AS (${Prisma.join(pieces,' UNION ALL ')}) SELECT label,COUNT(*) FILTER(WHERE confirmed AND at>=${start} AND at<${end}) AS confirmed,COUNT(*) FILTER(WHERE failed) AS failed,COUNT(*) FILTER(WHERE pending AND NOT confirmed) AS pending,COUNT(DISTINCT batch) FILTER(WHERE confirmed AND at>=${start} AND at<${end}) AS batches,NULL::text AS date FROM records GROUP BY label
 UNION ALL SELECT 'DAILY' AS label,COUNT(*) AS confirmed,0::bigint AS failed,0::bigint AS pending,0::bigint AS batches,to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS date FROM records WHERE confirmed AND at>=${start} AND at<${end} GROUP BY date`);
}
