ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "sourceClientId" TEXT;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "remoteId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Category_organizationId_sourceClientId_remoteId_key" ON "Category"("organizationId", "sourceClientId", "remoteId");
