import "server-only";
import {unstable_cache} from "next/cache";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import type {LiveMonitoringTicket} from "./monitoring-insights";
import {attentionStartedAt} from "./attention-start";
import {liveMonitoringTag} from "./monitoring-cache";
export async function liveMonitoringTickets(organizationId:string,recipient:string|null,phone:string|null,baseline:Date|null,clientId="",assigneeId=""){
 if(!recipient||!phone)return [];
 const attentionBaseline=await attentionStartedAt(organizationId,recipient);
 const rows=await unstable_cache(async()=>prisma.$queryRaw<LiveMonitoringTicket[]>(Prisma.sql`
 SELECT t.id,COALESCE(t."senderName",t.subject) AS contact,t."clientId",COALESCE(c.name,'Sem cliente vinculado') AS client,
 t."assignedToId" AS "assigneeId",COALESCE(u.name,u.email,'Na fila') AS assignee,t.status::text,t."receivedAt",t."assignedAt",t."firstResponseAt",t."lastMessageAt",
 latest.id AS "lastMessageId",latest."receivedAt" AS "lastOperationalMessageAt",CASE WHEN latest.direction::text='INBOUND' THEN pending."pendingSince" ELSE NULL END AS "pendingSince",
 CASE WHEN latest.direction::text='INBOUND' THEN pending."pendingText" ELSE NULL END AS "pendingText"
 FROM "ServiceTicket" t LEFT JOIN "Client" c ON c.id=t."clientId" AND c."organizationId"=t."organizationId" LEFT JOIN "User" u ON u.id=t."assignedToId"
 LEFT JOIN LATERAL (SELECT m.id,m.direction,m."receivedAt" FROM "ServiceMessage" m WHERE m."ticketId"=t.id AND m.direction::text IN ('INBOUND','OUTBOUND') AND m."receivedAt">=t."receivedAt" AND (m."providerMetadata"->>'accountPhone'=${phone} OR m."externalMessageId" LIKE ${`uazapi:${phone}:%`}) AND COALESCE(m."providerMetadata"->>'historical','false')<>'true' AND COALESCE(m."providerMetadata"->>'type','')<>'WHATSAPP_SURVEY' ORDER BY m."receivedAt" DESC,m.id DESC LIMIT 1) latest ON true
 LEFT JOIN LATERAL (SELECT MIN(p."pendingSince") AS "pendingSince",LEFT(STRING_AGG(SUBSTRING(p."textBody",1,500),' ' ORDER BY p."receivedAt" DESC) FILTER (WHERE ${attentionBaseline}::timestamptz IS NULL OR p."receivedAt">${attentionBaseline}),1000) AS "pendingText" FROM (SELECT MIN(m."receivedAt") OVER () AS "pendingSince",m."receivedAt",m."textBody" FROM "ServiceMessage" m WHERE m."ticketId"=t.id AND m.direction::text='INBOUND' AND COALESCE(m."providerMetadata"->>'historical','false')<>'true' AND (m."providerMetadata"->>'accountPhone'=${phone} OR m."externalMessageId" LIKE ${`uazapi:${phone}:%`}) AND m."receivedAt">=t."receivedAt" AND m."receivedAt">COALESCE((SELECT MAX(o."receivedAt") FROM "ServiceMessage" o WHERE o."ticketId"=t.id AND o.direction::text='OUTBOUND' AND COALESCE(o."providerMetadata"->>'type','')<>'WHATSAPP_SURVEY' AND (o."providerMetadata"->>'accountPhone'=${phone} OR o."externalMessageId" LIKE ${`uazapi:${phone}:%`})),t."receivedAt"-interval '1 millisecond') ORDER BY m."receivedAt" DESC LIMIT 20) p) pending ON true
 WHERE t."organizationId"=${organizationId} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."mergedIntoId" IS NULL AND t."isSpam"=false AND t.status::text NOT IN ('RESOLVED','SPAM')
 AND (${baseline}::timestamptz IS NULL OR t."receivedAt">=${baseline}) AND (${clientId}='' OR t."clientId"=${clientId}) AND (${assigneeId}='' OR t."assignedToId"=${assigneeId})
 ORDER BY CASE WHEN latest.direction::text='INBOUND' THEN 0 ELSE 1 END,pending."pendingSince" ASC NULLS LAST,t."receivedAt" ASC LIMIT 1001
 `),["wa-live-monitor-v2",organizationId,recipient,phone,baseline?.toISOString()||"",clientId,assigneeId,attentionBaseline?.toISOString()||""],{revalidate:30,tags:[liveMonitoringTag(organizationId,recipient)]})();
 // Next's data cache serializes Date values as strings on cache hits.
 return rows.map(row=>({...row,attentionStartedAt:attentionBaseline,receivedAt:new Date(row.receivedAt),assignedAt:row.assignedAt?new Date(row.assignedAt):null,firstResponseAt:row.firstResponseAt?new Date(row.firstResponseAt):null,pendingSince:row.pendingSince?new Date(row.pendingSince):null,lastMessageAt:new Date(row.lastMessageAt),lastOperationalMessageAt:row.lastOperationalMessageAt?new Date(row.lastOperationalMessageAt):null}));
}
