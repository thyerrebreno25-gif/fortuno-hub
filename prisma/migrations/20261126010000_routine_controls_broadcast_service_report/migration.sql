CREATE TABLE IF NOT EXISTS "OperationClientRoutineState" (
 "clientId" TEXT PRIMARY KEY REFERENCES "Client"(id) ON DELETE CASCADE,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 suspended BOOLEAN NOT NULL DEFAULT false, onboarding BOOLEAN NOT NULL DEFAULT false,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "WhatsAppBroadcastList" (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "accountRecipient" TEXT NOT NULL, "createdById" TEXT NOT NULL, name TEXT NOT NULL,
 recipients JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WhatsAppBroadcastList_scope_idx" ON "WhatsAppBroadcastList" ("organizationId","accountRecipient");
-- Separate delivery keys preserve the idempotency and history of the 08h report.
CREATE TABLE IF NOT EXISTS "OperatorServiceReportDelivery" (LIKE "OperatorReportDelivery" INCLUDING ALL);
ALTER TABLE "OperationClientRoutineState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppBroadcastList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorServiceReportDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "OperationClientRoutineState","WhatsAppBroadcastList","OperatorServiceReportDelivery" FROM anon,authenticated;
