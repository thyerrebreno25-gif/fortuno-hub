CREATE TABLE IF NOT EXISTS "HubUsageSession" (
 "id" TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "pageKey" TEXT NOT NULL,
 "clientId" TEXT REFERENCES "Client"("id") ON DELETE SET NULL,
 "activeSeconds" INTEGER NOT NULL DEFAULT 0 CHECK ("activeSeconds" >= 0 AND "activeSeconds" <= 43200),
 "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HubUsageSession_organizationId_startedAt_idx" ON "HubUsageSession"("organizationId","startedAt");
CREATE INDEX IF NOT EXISTS "HubUsageSession_organizationId_userId_startedAt_idx" ON "HubUsageSession"("organizationId","userId","startedAt");
CREATE INDEX IF NOT EXISTS "HubUsageSession_organizationId_clientId_startedAt_idx" ON "HubUsageSession"("organizationId","clientId","startedAt");
