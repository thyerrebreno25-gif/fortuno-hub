import "server-only";
import {prisma} from "@/lib/prisma";
import {Prisma} from "@/generated/prisma/client";
import type {AnalyticsPeriod} from "@/modules/operations/analytics";
import {operationStartedAt} from "@/modules/whatsapp/operation-start";
import {attentionStartedAt} from "@/modules/whatsapp/attention-start";
import type {ServiceReportSnapshot} from "./operator-report-model";
export async function buildServiceSnapshot(org:string,recipient:string,ids:string[],period:AnalyticsPeriod,now:Date):Promise<ServiceReportSnapshot>{
 const [baseline,reset]=await Promise.all([operationStartedAt(org,recipient),attentionStartedAt(org,recipient)]),floor=baseline&&reset?new Date(Math.max(+baseline,+reset)):baseline||reset;
 const [rows,resolutions,surveys]=await Promise.all([
  prisma.$queryRaw<Array<{id:string;clientId:string|null;client:string;status:string;sector:string;queueMinutes:number|null}>>(Prisma.sql`SELECT t.id,t."clientId",COALESCE(c.name,'Sem cliente vinculado') AS client,t.status::text,COALESCE(t."whatsappDepartmentName",'Sem setor') AS sector,
   CASE WHEN t."assignedToId" IS NULL THEN GREATEST(0,EXTRACT(EPOCH FROM (${now}::timestamptz-GREATEST(t."receivedAt",COALESCE(${floor}::timestamptz,t."receivedAt"))))/60)::float8 ELSE NULL END AS "queueMinutes"
   FROM "ServiceTicket" t LEFT JOIN "Client" c ON c.id=t."clientId" AND c."organizationId"=t."organizationId"
   WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."isSpam"=false AND t."mergedIntoId" IS NULL AND t.status::text NOT IN ('RESOLVED','SPAM')
   AND (t."assignedToId" IS NULL OR t."assignedToId" IN (${ids.length?Prisma.join(ids):Prisma.sql`NULL`})) AND t."receivedAt"<${period.end} AND t."receivedAt"<=${now} AND (${baseline}::timestamptz IS NULL OR t."receivedAt">=${baseline})`),
  prisma.$queryRaw<Array<{average:number|null;samples:number}>>(Prisma.sql`SELECT AVG(EXTRACT(EPOCH FROM (t."resolvedAt"-GREATEST(t."receivedAt",COALESCE(${floor}::timestamptz,t."receivedAt"))))/60)::float8 AS average,COUNT(*)::int AS samples FROM "ServiceTicket" t WHERE t."organizationId"=${org} AND t."recipientEmail"=${recipient} AND t.source='WHATSAPP_API' AND t."isSpam"=false AND t."mergedIntoId" IS NULL AND t.status::text='RESOLVED' AND t."resolvedAt">=${period.start} AND t."resolvedAt"<${period.end} AND t."resolvedAt"<=${now} AND t."resolvedAt">=t."receivedAt" AND (${floor}::timestamptz IS NULL OR t."receivedAt">=${floor}) AND t."resolvedById" IN (${ids.length?Prisma.join(ids):Prisma.sql`NULL`})`),
  prisma.$queryRaw<Array<{average:number|null;samples:number}>>(Prisma.sql`SELECT AVG(score)::float8 AS average,COUNT(*)::int AS samples FROM "WhatsAppSurvey" WHERE "organizationId"=${org} AND "accountRecipient"=${recipient} AND score IS NOT NULL AND "answeredAt">=${new Date(+now-30*86400000)} AND "answeredAt"<=${now} AND "operatorId" IN (${ids.length?Prisma.join(ids):Prisma.sql`NULL`})`),
 ]);
 const grouped=(key:"status"|"sector"|"client")=>[...rows.reduce((m,r)=>m.set(r[key],(m.get(r[key])||0)+1),new Map<string,number>())].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,"pt-BR"));
 const waits=rows.filter(r=>r.queueMinutes!==null).map(r=>Number(r.queueMinutes));
 return {open:rows.length,clients:new Set(rows.map(r=>r.clientId).filter(Boolean)).size,queue:waits.length,averageQueueMinutes:waits.length?Math.round(waits.reduce((a,b)=>a+b,0)/waits.length):null,longestQueueMinutes:waits.length?Math.round(Math.max(...waits)):null,averageResolutionMinutes:resolutions[0]?.average??null,resolutionSamples:resolutions[0]?.samples||0,satisfaction:surveys[0]?.average??null,satisfactionSamples:surveys[0]?.samples||0,byStatus:grouped("status"),bySector:grouped("sector"),openClients:grouped("client")};
}
