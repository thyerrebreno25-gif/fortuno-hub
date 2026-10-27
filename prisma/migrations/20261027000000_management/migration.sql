CREATE TABLE IF NOT EXISTS "ClientManagement" (
  "clientId" TEXT PRIMARY KEY REFERENCES "Client"("id") ON DELETE CASCADE,
  "organizationId" TEXT NOT NULL,
  "snapshot" JSONB,
  "checkedAccounts" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "notionPageId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "refreshedAt" TIMESTAMP(3),
  "refreshLeaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ClientManagement_organizationId_idx" ON "ClientManagement"("organizationId");
