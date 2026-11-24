CREATE TABLE IF NOT EXISTS "OperatorReportConfig" (
 "organizationId" TEXT PRIMARY KEY REFERENCES "Organization"(id) ON DELETE CASCADE,
 "revision" TEXT NOT NULL, "configuredById" TEXT NOT NULL,
 "destinationName" TEXT NOT NULL, "webhookEncrypted" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "OperatorReportDelivery" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "day" TEXT NOT NULL, "configRevision" TEXT NOT NULL,
 "snapshot" JSONB NOT NULL, "messages" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'READY', "sentParts" INTEGER NOT NULL DEFAULT 0,
 "attempts" INTEGER NOT NULL DEFAULT 0, "leaseId" TEXT, "leaseUntil" TIMESTAMP(3),
 "retryAt" TIMESTAMP(3), "lastError" TEXT, "sentAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("organizationId","day")
);
CREATE INDEX IF NOT EXISTS "OperatorReportConfig_enabled_idx" ON "OperatorReportConfig"("enabled","updatedAt");
