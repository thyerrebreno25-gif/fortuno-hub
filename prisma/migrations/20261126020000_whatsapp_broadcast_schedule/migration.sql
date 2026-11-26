CREATE TABLE IF NOT EXISTS "WhatsAppBroadcastSchedule" (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "userId" TEXT NOT NULL, "accountRecipient" TEXT NOT NULL,
 name TEXT NOT NULL, body TEXT NOT NULL, recipients JSONB NOT NULL, fingerprint TEXT NOT NULL,
 "scheduledAt" TIMESTAMPTZ NOT NULL, status TEXT NOT NULL DEFAULT 'SCHEDULED',
 "leaseId" TEXT, "leaseUntil" TIMESTAMPTZ, "acknowledgedIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
 "lastError" TEXT, "startedAt" TIMESTAMPTZ, "completedAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WhatsAppBroadcastSchedule_due_idx" ON "WhatsAppBroadcastSchedule" (status,"scheduledAt","leaseUntil");
CREATE INDEX IF NOT EXISTS "WhatsAppBroadcastSchedule_scope_idx" ON "WhatsAppBroadcastSchedule" ("organizationId","accountRecipient","userId");
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBroadcastSchedule_intent_idx" ON "WhatsAppBroadcastSchedule" ("organizationId","userId",fingerprint) WHERE status<>'CANCELLED';
ALTER TABLE "WhatsAppBroadcastSchedule" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "WhatsAppBroadcastSchedule" FROM anon,authenticated;
