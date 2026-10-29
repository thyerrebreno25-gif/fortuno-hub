ALTER TABLE "ServiceTicket" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
CREATE INDEX IF NOT EXISTS "ServiceTicket_mergedIntoId_idx" ON "ServiceTicket"("mergedIntoId");
