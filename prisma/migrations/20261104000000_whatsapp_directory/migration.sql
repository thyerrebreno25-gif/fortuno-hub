CREATE TABLE IF NOT EXISTS "WhatsAppDirectoryEntry" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "connectionId" TEXT NOT NULL REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE,
 "accountPhone" TEXT NOT NULL, "externalId" TEXT NOT NULL, "kind" TEXT NOT NULL, "displayName" TEXT NOT NULL,
 "generation" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppDirectoryEntry_connectionId_accountPhone_externalId_key" ON "WhatsAppDirectoryEntry"("connectionId","accountPhone","externalId");
CREATE INDEX IF NOT EXISTS "WhatsAppDirectoryEntry_scope_idx" ON "WhatsAppDirectoryEntry"("organizationId","connectionId","accountPhone","active","kind");
CREATE TABLE IF NOT EXISTS "WhatsAppDirectorySync" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "connectionId" TEXT NOT NULL REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE,
 "accountPhone" TEXT NOT NULL, "instanceId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "phase" TEXT NOT NULL DEFAULT 'CONTACTS',
 "offset" INTEGER NOT NULL DEFAULT 0, "generation" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
 "claimedAt" TIMESTAMP(3), "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppDirectorySync_connectionId_accountPhone_key" ON "WhatsAppDirectorySync"("connectionId","accountPhone");
CREATE INDEX IF NOT EXISTS "WhatsAppDirectorySync_status_nextRunAt_idx" ON "WhatsAppDirectorySync"("status","nextRunAt");
