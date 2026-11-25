import "server-only";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {attentionStartedAt} from "@/modules/whatsapp/attention-start";
import {operationStartedAt} from "@/modules/whatsapp/operation-start";
import {summarizeOperatorService,type ServiceOpenRow,type ServiceResponseRow} from "./operator-service-attention";
import type {OperatorDayRow} from "./operator-report-model";
import type {AnalyticsPeriod} from "@/modules/operations/analytics";
// Prefix filters are shared by all message subqueries: no customer text is selected.
function messageScope(alias:string,phone:string){
 const m=Prisma.raw(alias);
 return Prisma.sql`(${m}."providerMetadata"->>'accountPhone'=${phone} OR ${m}."externalMessageId" LIKE ${`uazapi:${phone}:%`})
 AND COALESCE(${m}."providerMetadata"->>'historical','false')<>'true' AND COALESCE(${m}."providerMetadata"->>'type','')<>'WHATSAPP_SURVEY'
 AND ${m}."providerMetadata"->>'deletedAt' IS NULL AND COALESCE(${m}."deliveryStatus",'') NOT IN ('failed','unconfirmed')
 AND NOT EXISTS(SELECT 1 FROM "ServiceMessage" original WHERE original."ticketId"=${m}."ticketId" AND original."providerMetadata"->>'reconciledEchoId'=${m}.id)`;
}
export async function operatorServiceAttention(org:string,recipient:string,phone:string,operators:OperatorDayRow[],period:AnalyticsPeriod,now:Date){
 if(!operators.length)return summarizeOperatorService([],[],[],now);
 const ids=operators.map(row=>row.userId),[baseline,reset]=await Promise.all([operationStartedAt(org,recipient),attentionStartedAt(org,recipient)]);
 const floor=baseline&&reset?new Date(Math.max(+baseline,+reset)):baseline||reset;
 const [openRows,responses]=await Promise.all([
  prisma.$queryRaw<ServiceOpenRow[]>(Prisma.sql`
   SELECT t.id,t."assignedToId" AS "userId",COALESCE(t."senderName",t.subject,'Conversa') AS contact,COALESCE(c.name,'Sem cliente vinculado') AS client,t.status::text,t."receivedAt" AS "openedAt",outgoing."lastOutboundAt",pending."pendingSince"
   FROM "ServiceTicket" t LEFT JOIN "Client" c ON c.id=t."clientId" AND c."organizationId"=t."organizationId"
   LEFT JOIN LATERAL (SELECT MAX(o."receivedAt") AS "lastOutboundAt" FROM "ServiceMessage" o WHERE o."ticketId"=t.id AND o.direction::text='OUTBOUND' AND o."receivedAt">=t."receivedAt" AND o."receivedAt"<=${now} AND ${messageScope("o",phone)}) outgoing ON true
   LEFT JOIN LATERAL (SELECT MIN(i."receivedAt") AS "pendingSince" FROM "ServiceMessage" i WHERE i."ticketId"=t.id AND i.direction::text='INBOUND' AND i."receivedAt">=t."receivedAt" AND i."receivedAt"<=${now} AND (outgoing."lastOutboundAt" IS NULL OR i."receivedAt">outgoing."lastOutboundAt") AND ${messageScope("i",phone)}) pending ON true
   WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."isSpam"=false AND t."mergedIntoId" IS NULL
   AND t.status::text NOT IN ('RESOLVED','SPAM') AND t."assignedToId" IN (${Prisma.join(ids)}) AND t."receivedAt"<${period.end} AND t."receivedAt"<=${now}
   AND (${baseline}::timestamptz IS NULL OR t."receivedAt">=${baseline}) ORDER BY t."receivedAt",t.id LIMIT 5001`),
  prisma.$queryRaw<Array<ServiceResponseRow&{limited?:boolean}>>(Prisma.sql`
   WITH outgoing AS (SELECT o.id,o."ticketId",o."providerMetadata",o."fromEmail",o."externalMessageId",o."receivedAt" FROM "ServiceMessage" o JOIN "ServiceTicket" t ON t.id=o."ticketId"
    WHERE t."organizationId"=${org} AND t.source='WHATSAPP_API' AND t."recipientEmail"=${recipient} AND t."isSpam"=false AND t."mergedIntoId" IS NULL
    AND o.direction::text='OUTBOUND' AND o."receivedAt">=${period.start} AND o."receivedAt"<${period.end} AND o."receivedAt"<=${now}
    AND (${baseline}::timestamptz IS NULL OR o."receivedAt">=${baseline}) AND ${messageScope("o",phone)} ORDER BY o."receivedAt",o.id LIMIT 20001), measured AS (
   SELECT actor."userId",EXTRACT(EPOCH FROM (o."receivedAt"-burst."pendingSince"))/60.0::float8 AS minutes FROM outgoing o
   JOIN LATERAL (SELECT u.id AS "userId" FROM "OrganizationMember" om JOIN "User" u ON u.id=om."userId"
    WHERE om."organizationId"=${org} AND u.id IN (${Prisma.join(ids)}) AND (u.id=o."providerMetadata"->>'userId' OR LOWER(u.email)=LOWER(o."fromEmail") OR EXISTS(SELECT 1 FROM "ServiceTicketHistory" h WHERE h."ticketId"=o."ticketId" AND h."userId"=u.id AND (h.type='WHATSAPP_REPLIED' OR h.type IN ('WHATSAPP_MEDIA_UPLOAD','WHATSAPP_FORWARDED') AND h.metadata->>'state'='SENT') AND (h.metadata->>'messageId'=o.id OR h.metadata->>'externalMessageId'=o."externalMessageId")))
    ORDER BY CASE WHEN u.id=o."providerMetadata"->>'userId' THEN 0 WHEN LOWER(u.email)=LOWER(o."fromEmail") THEN 1 ELSE 2 END,u.id LIMIT 1) actor ON true
   LEFT JOIN LATERAL (SELECT p.id,p."receivedAt" FROM "ServiceMessage" p WHERE p."ticketId"=o."ticketId" AND p.direction::text='OUTBOUND' AND (p."receivedAt",p.id)<(o."receivedAt",o.id) AND ${messageScope("p",phone)} ORDER BY p."receivedAt" DESC,p.id DESC LIMIT 1) previous ON true
   LEFT JOIN LATERAL (SELECT MAX(h."createdAt") AS "closedAt" FROM "ServiceTicketHistory" h WHERE h."ticketId"=o."ticketId" AND h.type='WHATSAPP_RESOLVED' AND h."createdAt"<=o."receivedAt") closed ON true
   JOIN LATERAL (SELECT MIN(i."receivedAt") AS "pendingSince" FROM "ServiceMessage" i WHERE i."ticketId"=o."ticketId" AND i.direction::text='INBOUND' AND (i."receivedAt",i.id)<=(o."receivedAt",o.id)
    AND (previous.id IS NULL OR (i."receivedAt",i.id)>(previous."receivedAt",previous.id)) AND (closed."closedAt" IS NULL OR i."receivedAt">=closed."closedAt")
    AND (${baseline}::timestamptz IS NULL OR i."receivedAt">=${baseline}) AND ${messageScope("i",phone)}) burst ON burst."pendingSince" IS NOT NULL
   ORDER BY o."receivedAt",o.id)
   SELECT "userId",minutes,false AS limited FROM measured UNION ALL SELECT '',0::float8,COUNT(*)>20000 FROM outgoing`),
 ]);
 return summarizeOperatorService(operators,openRows.slice(0,5000),responses.filter(row=>row.userId).slice(0,20000).map(row=>({...row,minutes:Number(row.minutes)})),now,floor,openRows.length>5000||responses.some(row=>row.limited===true));
}
