CREATE TABLE IF NOT EXISTS "WhatsAppConnection" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL UNIQUE REFERENCES "Organization"("id") ON DELETE CASCADE,
 "serverUrl" TEXT NOT NULL, "tokenEncrypted" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "instanceId" TEXT NOT NULL,
 "instanceName" TEXT, "phone" TEXT, "profileName" TEXT, "status" TEXT NOT NULL DEFAULT 'DISCONNECTED', "webhookId" TEXT,
 "webhookConfiguredAt" TIMESTAMP(3), "lastWebhookAt" TIMESTAMP(3), "lastCheckedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "WhatsAppWebhookInbox" (
 "id" TEXT PRIMARY KEY, "connectionId" TEXT NOT NULL REFERENCES "WhatsAppConnection"("id") ON DELETE CASCADE, "eventType" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processedAt" TIMESTAMP(3), "claimedAt" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "WhatsAppWebhookInbox_connectionId_status_receivedAt_idx" ON "WhatsAppWebhookInbox"("connectionId", "status", "receivedAt");
