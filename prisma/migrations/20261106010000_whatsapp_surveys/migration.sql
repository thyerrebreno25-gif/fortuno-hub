CREATE TABLE IF NOT EXISTS "WhatsAppSurveyPolicy" (
 "organizationId" TEXT PRIMARY KEY REFERENCES "Organization"(id) ON DELETE CASCADE,
 enabled BOOLEAN NOT NULL DEFAULT false, "cadenceDays" INTEGER NOT NULL DEFAULT 15,
 "delayMinutes" INTEGER NOT NULL DEFAULT 30, message TEXT NOT NULL,
 "activatedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "WhatsAppSurveyClientState" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "clientId" TEXT NOT NULL REFERENCES "Client"(id) ON DELETE CASCADE, "optedOutAt" TIMESTAMP(3),
 PRIMARY KEY("organizationId","clientId")
);
CREATE TABLE IF NOT EXISTS "WhatsAppSurvey" (
 id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "clientId" TEXT NOT NULL, "clientName" TEXT NOT NULL, "operatorId" TEXT NOT NULL,
 "operatorName" TEXT NOT NULL, "ticketId" TEXT NOT NULL, "accountRecipient" TEXT NOT NULL,
 destination TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', "scheduledAt" TIMESTAMP(3) NOT NULL,
 "sentAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "answeredAt" TIMESTAMP(3),
 score INTEGER CHECK(score BETWEEN 1 AND 5), comment TEXT, "tokenHash" TEXT UNIQUE,
 "externalMessageId" TEXT, error TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "WhatsAppSurvey_organizationId_clientId_createdAt_idx" ON "WhatsAppSurvey"("organizationId","clientId","createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppSurvey_status_scheduledAt_idx" ON "WhatsAppSurvey"(status,"scheduledAt");
CREATE INDEX IF NOT EXISTS "WhatsAppSurvey_organizationId_accountRecipient_sentAt_idx" ON "WhatsAppSurvey"("organizationId","accountRecipient","sentAt");

CREATE TABLE IF NOT EXISTS "WhatsAppOperationStart" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "accountRecipient" TEXT NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL,
 "startedById" TEXT NOT NULL, "closedCount" INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY("organizationId","accountRecipient")
);
CREATE INDEX IF NOT EXISTS "WhatsAppOperationStart_organizationId_startedAt_idx" ON "WhatsAppOperationStart"("organizationId","startedAt");
