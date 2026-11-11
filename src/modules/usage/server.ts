import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { usagePages } from "./catalog";
import { buildUsageReport, emptyMetrics, usagePeriod, type UsageRecord, type UsagePayload } from "./model";
import type { ModuleCode, PermissionShape } from "@/modules/permissions/permissions";

type Raw = { userId: string | null; clientId: string | null; pageKey: string; day: string; lastAt: Date; actions: bigint; imports: bigint; caSends: bigint; messages: bigint; visits: bigint; activeSeconds: number | bigint; taskSeconds: number | bigint };
export async function usageSnapshot(org: string, period: ReturnType<typeof usagePeriod>, permissions: Record<ModuleCode, PermissionShape>, filters: {userId?: string; clientId?: string; pageKey?: string}): Promise<UsagePayload> {
  const { start, end } = period;
  const allowed = usagePages.filter(p => permissions[p.module].canView);
  const can = (key: string) => allowed.some(p => p.key === key);
  const pieces: Prisma.Sql[] = [];
  // Every source is tenant-scoped and dated at the recorded human action, never the last polling update.
  if (permissions.IMPORTS.canView || can("exchange")) pieces.push(Prisma.sql`
    SELECT i."userId",i."clientId",CASE i.module WHEN 'BANK_STATEMENT' THEN 'statements' WHEN 'CREDIT_CARD_INVOICE' THEN 'invoices' WHEN 'ACQUIRER' THEN 'acquirers' WHEN 'EXCHANGE' THEN 'exchange' ELSE 'history' END AS page,i."createdAt" AS at,1 AS actions,1 AS imports,0 AS exports,0 AS messages,0 AS visits,0::numeric AS active,0::numeric AS task
    FROM "ImportJob" i WHERE i."organizationId"=${org} AND i."createdAt">=${start} AND i."createdAt"<${end}`);
  if(can("purchases")) {
    pieces.push(Prisma.sql`SELECT "createdById","clientId",'purchases',"createdAt",1,1,0,0,0,0,0 FROM "PurchaseInvoice" WHERE "organizationId"=${org} AND source='XML_UPLOAD' AND "createdAt">=${start} AND "createdAt"<${end}`);
    pieces.push(Prisma.sql`SELECT "createdById","clientId",'purchases',"sentAt",1,0,1,0,0,0,0 FROM "PurchaseInvoice" WHERE "organizationId"=${org} AND source='XML_UPLOAD' AND status='SENT' AND "sentAt">=${start} AND "sentAt"<${end}`);
  }
  const kinds = [...(can("investment") ? ["INVESTMENT"] : []), ...(can("contracts") ? ["CONTRACT"] : [])];
  if(kinds.length) {
    pieces.push(Prisma.sql`SELECT "userId","clientId",CASE kind WHEN 'INVESTMENT' THEN 'investment' ELSE 'contracts' END,"createdAt",1,1,0,0,0,0,0 FROM "DocumentImportReview" WHERE "organizationId"=${org} AND kind IN (${Prisma.join(kinds)}) AND "createdAt">=${start} AND "createdAt"<${end}`);
    // A delivery is a confirmed sale/contract; repeating a status check never creates another action.
    pieces.push(Prisma.sql`SELECT r."userId",r."clientId",CASE r.kind WHEN 'INVESTMENT' THEN 'investment' ELSE 'contracts' END,d."createdAt",1,0,1,0,0,0,0 FROM "DocumentImportDelivery" d JOIN "DocumentImportReview" r ON r.id=d."reviewId" WHERE d."organizationId"=${org} AND r."organizationId"=${org} AND r.kind IN (${Prisma.join(kinds)}) AND d.status='SENT' AND d."createdAt">=${start} AND d."createdAt"<${end}`);
  }
  if(permissions.IMPORTS.canView || can("whatsapp")) pieces.push(Prisma.sql`SELECT e."createdById",e."clientId",CASE e.module WHEN 'ACQUIRER' THEN 'acquirers' WHEN 'WHATSAPP' THEN 'whatsapp' ELSE 'invoices' END,e."completedAt",1,0,1,0,0,0,0 FROM "ContaAzulFinancialExport" e WHERE e."organizationId"=${org} AND e.status IN ('COMPLETED','PARTIAL') AND e."completedAt">=${start} AND e."completedAt"<${end} AND EXISTS(SELECT 1 FROM "ContaAzulFinancialExportLine" l WHERE l."exportId"=e.id AND (l.status='SETTLED' OR NULLIF(l.metadata->>'creationConfirmedAt','') IS NOT NULL))`);
  if(can("operations")) {
    pieces.push(Prisma.sql`SELECT e."userId",a."clientId",'operations',e."createdAt",1,0,0,0,0,0,0 FROM "OperationEvent" e JOIN "OperationActivity" a ON a.id=e."activityId" WHERE a."organizationId"=${org} AND e.type NOT IN ('CREATED','EMAIL_SENT','EMAIL_FAILED') AND e."createdAt">=${start} AND e."createdAt"<${end}`);
    pieces.push(Prisma.sql`SELECT t."userId",a."clientId",'operations',GREATEST(t."startedAt",${start}),0,0,0,0,0,0,CASE WHEN t."endedAt" IS NOT NULL THEN CASE WHEN t."endedAt">t."startedAt" THEN GREATEST(0,t.seconds)*GREATEST(0,EXTRACT(EPOCH FROM (LEAST(t."endedAt",${end})-GREATEST(t."startedAt",${start}))))/EXTRACT(EPOCH FROM (t."endedAt"-t."startedAt")) ELSE 0 END ELSE GREATEST(0,EXTRACT(EPOCH FROM (LEAST(CURRENT_TIMESTAMP,${end})-GREATEST(t."startedAt",${start})))) END FROM "OperationTimeEntry" t JOIN "OperationActivity" a ON a.id=t."activityId" WHERE a."organizationId"=${org} AND t."startedAt"<${end} AND COALESCE(t."endedAt",CURRENT_TIMESTAMP)>${start}`);
  }
  const channels = [...(can("whatsapp") ? ["WHATSAPP_API"] : []), ...(can("email") ? ["GMAIL","MANUAL"] : [])];
  if(channels.length) pieces.push(Prisma.sql`SELECT h."userId",t."clientId",CASE WHEN t.source='WHATSAPP_API' THEN 'whatsapp' ELSE 'email' END,h."createdAt",1,0,0,CASE WHEN h.type IN ('WHATSAPP_REPLIED','GMAIL_REPLY_SENT') OR (h.type IN ('WHATSAPP_FORWARDED','WHATSAPP_MEDIA_UPLOAD') AND h.metadata->>'state'='SENT') THEN 1 ELSE 0 END,0,0,0 FROM "ServiceTicketHistory" h JOIN "ServiceTicket" t ON t.id=h."ticketId" WHERE t."organizationId"=${org} AND t.source IN (${Prisma.join(channels)}) AND h."userId" IS NOT NULL AND h.type NOT IN ('WHATSAPP_DUPLICATES_MERGED','MAILBOX_ARCHIVED','WHATSAPP_OPERATION_START') AND h."createdAt">=${start} AND h."createdAt"<${end}`);
  if(can("meetings")) {
    pieces.push(Prisma.sql`SELECT "createdById",NULL::text,'meetings',"createdAt",1,0,0,0,0,0,0 FROM "TeamMeeting" WHERE "organizationId"=${org} AND "createdAt">=${start} AND "createdAt"<${end}`);
    pieces.push(Prisma.sql`SELECT n."authorId",NULL::text,'meetings',n."createdAt",1,0,0,0,0,0,0 FROM "MeetingNote" n JOIN "TeamMeeting" m ON m.id=n."meetingId" WHERE m."organizationId"=${org} AND n."createdAt">=${start} AND n."createdAt"<${end}`);
  }
  if(can("calendar")) pieces.push(Prisma.sql`SELECT "userId",NULL::text,'calendar',"createdAt",1,0,0,0,0,0,0 FROM "TeamCalendarEvent" WHERE "organizationId"=${org} AND "meetingId" IS NULL AND "actionItemId" IS NULL AND "createdAt">=${start} AND "createdAt"<${end}`);
  if(can("onboarding")) pieces.push(Prisma.sql`SELECT h."userId",o."clientId",'onboarding',h."createdAt",1,0,0,0,0,0,0 FROM "OnboardingHistory" h JOIN "Onboarding" o ON o.id=h."onboardingId" WHERE o."organizationId"=${org} AND h."createdAt">=${start} AND h."createdAt"<${end}`);
  if(can("audit")) pieces.push(Prisma.sql`SELECT i."userId",a."clientId",'audit',i."createdAt",1,0,0,0,0,0,0 FROM "AuditInteraction" i JOIN "AuditFinding" f ON f.id=i."findingId" JOIN "Audit" a ON a.id=f."auditId" WHERE a."organizationId"=${org} AND i."createdAt">=${start} AND i."createdAt"<${end}`);
  if(can("mapping")) pieces.push(Prisma.sql`SELECT "createdById","clientId",'mapping',"createdAt",1,0,0,0,0,0,0 FROM "OperationalMapping" WHERE "organizationId"=${org} AND "createdAt">=${start} AND "createdAt"<${end}`);
  if(can("assistant")) pieces.push(Prisma.sql`SELECT c."userId",c."clientId",'assistant',m."createdAt",1,0,0,0,0,0,0 FROM "AssistantMessage" m JOIN "AssistantConversation" c ON c.id=m."conversationId" WHERE c."organizationId"=${org} AND m.role='USER' AND m."createdAt">=${start} AND m."createdAt"<${end}`);
  if(can("notices")) pieces.push(Prisma.sql`SELECT m."userId",NULL::text,'notices',n."createdAt",1,0,0,0,0,0,0 FROM "Notice" n JOIN "OrganizationMember" m ON m.id=n."authorMemberId" AND m."organizationId"=${org} WHERE n."organizationId"=${org} AND n."createdAt">=${start} AND n."createdAt"<${end}`);
  if(can("support")) pieces.push(Prisma.sql`SELECT "userId",NULL::text,'support',"createdAt",1,0,0,0,0,0,0 FROM "SupportTicket" WHERE "organizationId"=${org} AND "createdAt">=${start} AND "createdAt"<${end}`);
  // Client edits and management checks have reliable actor audit logs, restricted through the actual tenant resource.
  if(can("clients") || can("management")) pieces.push(Prisma.sql`SELECT l."userId",c.id,CASE WHEN l.action LIKE 'MANAGEMENT_%' THEN 'management' ELSE 'clients' END,l."createdAt",1,0,0,0,0,0,0 FROM "AuditLog" l JOIN "Client" c ON c.id=l."entityId" WHERE c."organizationId"=${org} AND l.entity='Client' AND l.action NOT LIKE '%SYNC%' AND l."createdAt">=${start} AND l."createdAt"<${end}`);
  pieces.push(Prisma.sql`SELECT "userId","clientId","pageKey",LEAST("lastSeenAt",date_trunc('day',"startedAt"-INTERVAL '3 hours')+INTERVAL '1 day 3 hours'-INTERVAL '1 millisecond'),0,0,0,0,1,"activeSeconds",0 FROM "HubUsageSession" WHERE "organizationId"=${org} AND "startedAt">=${start} AND "startedAt"<${end}`);
  const combined = Prisma.join(pieces, " UNION ALL ");
  const [raw, members, clients, tracking] = await Promise.all([
    prisma.$queryRaw<Raw[]>(Prisma.sql`WITH records ("userId","clientId",page,at,actions,imports,exports,messages,visits,active,task) AS (${combined}) SELECT "userId","clientId",page AS "pageKey",to_char(at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD') AS day,MAX(at) AS "lastAt",SUM(actions)::bigint AS actions,SUM(imports)::bigint AS imports,SUM(exports)::bigint AS "caSends",SUM(messages)::bigint AS messages,SUM(visits)::bigint AS visits,SUM(active) AS "activeSeconds",SUM(task) AS "taskSeconds" FROM records WHERE page IN (${Prisma.join(allowed.map(p => p.key))}) ${filters.userId ? Prisma.sql`AND "userId"=${filters.userId}` : Prisma.empty} ${filters.clientId ? Prisma.sql`AND "clientId"=${filters.clientId}` : Prisma.empty} ${filters.pageKey ? Prisma.sql`AND page=${filters.pageKey}` : Prisma.empty} GROUP BY "userId","clientId",page,day`),
    prisma.organizationMember.findMany({ where: { organizationId: org, role: { not: "CLIENT" } }, select: { role: true, user: { select: { id: true, name: true } } } }),
    permissions.CLIENTS.canView ? prisma.client.findMany({ where: { organizationId: org, active: true }, select: { id: true, name: true, operationLeaderId: true, payableResponsibleId: true, receivableResponsibleId: true, generalResponsibleId: true } }) : [],
    prisma.hubUsageSession.aggregate({ where: { organizationId: org }, _min: { startedAt: true } }),
  ]);
  const people = members.map(m => ({ id: m.user.id, name: m.user.name || "Colaborador", role: m.role }));
  const names = new Map(people.map(p => [p.id, p.name]));
  const roster = clients.map(c => { const responsibleIds = [...new Set([c.operationLeaderId,c.payableResponsibleId,c.receivableResponsibleId,c.generalResponsibleId].filter((v): v is string => Boolean(v)))]; return { id: c.id, name: c.name, responsibleIds, responsibleNames: responsibleIds.map(id => names.get(id) || "Responsável anterior") }; });
  const records: UsageRecord[] = raw.map(r => ({ userId: r.userId, clientId: permissions.CLIENTS.canView ? r.clientId : null, pageKey: r.pageKey, day: r.day, lastAt: r.lastAt.toISOString(), actions: Number(r.actions), imports: Number(r.imports), caSends: Number(r.caSends), messages: Number(r.messages), visits: Number(r.visits), activeSeconds: Number(r.activeSeconds), taskSeconds: Number(r.taskSeconds) }));
  const report = buildUsageReport(records, people, roster, allowed, filters);
  const daily = new Map(report.daily.map(d => [d.day, d]));
  for (const cursor = new Date(period.from + "T12:00:00Z"); cursor.toISOString().slice(0,10) <= period.to; cursor.setUTCDate(cursor.getUTCDate()+1)) {
    const day = cursor.toISOString().slice(0,10);
    if(!daily.has(day)) daily.set(day,{...emptyMetrics(),id:day,name:day,day,activeDays:0,lastAt:null,users:0,clients:0,pages:0});
  }
  report.daily = [...daily.values()].sort((a,b) => a.day.localeCompare(b.day));
  return { ...report, generatedAt: new Date().toISOString(), trackingSince: tracking._min.startedAt?.toISOString() || null, from: period.from, to: period.to, people, clients: roster, pages: allowed.map(p => ({ key: p.key, label: p.label })) };
}
