ALTER TABLE "ServiceTicket" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
UPDATE "ServiceTicket" t SET "resolvedById"=h."userId" FROM (
 SELECT DISTINCT ON ("ticketId") "ticketId","userId" FROM "ServiceTicketHistory"
 WHERE type='WHATSAPP_RESOLVED' AND "userId" IS NOT NULL ORDER BY "ticketId","createdAt" DESC,id DESC
) h WHERE t.id=h."ticketId" AND t.source='WHATSAPP_API' AND t.status::text='RESOLVED' AND t."resolvedById" IS NULL;
