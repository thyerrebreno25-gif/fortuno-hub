CREATE TABLE IF NOT EXISTS "WhatsAppQuickReply" (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "WhatsAppQuickReply_organizationId_title_idx" ON "WhatsAppQuickReply"("organizationId",title);
CREATE TABLE IF NOT EXISTS "WhatsAppOperatorPreference" (
  "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "notificationsMuted" BOOLEAN NOT NULL DEFAULT false, "lastSeenAt" TIMESTAMP(3),
  PRIMARY KEY ("organizationId","userId")
);
CREATE TABLE IF NOT EXISTS "WhatsAppBatchDelivery" (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE, "batchId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL, "accountRecipient" TEXT NOT NULL, "recipientName" TEXT NOT NULL,
  body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', error TEXT, "externalMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppBatchDelivery_organizationId_userId_batchId_ticketId_key" ON "WhatsAppBatchDelivery"("organizationId","userId","batchId","ticketId");
CREATE INDEX IF NOT EXISTS "WhatsAppBatchDelivery_organizationId_userId_batchId_idx" ON "WhatsAppBatchDelivery"("organizationId","userId","batchId");
