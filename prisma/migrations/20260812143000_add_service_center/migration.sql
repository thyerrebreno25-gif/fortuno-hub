CREATE TYPE "ServiceTicketStatus" AS ENUM ('NEW','IN_PROGRESS','WAITING_CUSTOMER','WAITING_INTERNAL','RESOLVED','SPAM');
CREATE TYPE "ServiceTicketPriority" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE "ServiceMessageDirection" AS ENUM ('INBOUND','OUTBOUND','INTERNAL');

CREATE TABLE "EmailConnection" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL,
 "provider" TEXT NOT NULL DEFAULT 'GMAIL',
 "email" TEXT NOT NULL,
 "externalId" TEXT,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "lastSyncAt" TIMESTAMP(3),
 "watchExpiresAt" TIMESTAMP(3),
 "metadata" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientEmailIdentity" (
 "id" TEXT NOT NULL,
 "clientId" TEXT NOT NULL,
 "email" TEXT NOT NULL,
 "normalizedEmail" TEXT NOT NULL,
 "label" TEXT,
 "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ClientEmailIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceTicket" (
 "id" TEXT NOT NULL,
 "organizationId" TEXT NOT NULL,
 "clientId" TEXT,
 "assignedToId" TEXT,
 "externalThreadId" TEXT,
 "source" TEXT NOT NULL DEFAULT 'MANUAL',
 "subject" TEXT NOT NULL,
 "senderName" TEXT,
 "senderEmail" TEXT NOT NULL,
 "recipientEmail" TEXT,
 "snippet" TEXT,
 "status" "ServiceTicketStatus" NOT NULL DEFAULT 'NEW',
 "priority" "ServiceTicketPriority" NOT NULL DEFAULT 'MEDIUM',
 "isSpam" BOOLEAN NOT NULL DEFAULT false,
 "spamScore" INTEGER,
 "assignedAt" TIMESTAMP(3),
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolvedAt" TIMESTAMP(3),
 "firstResponseAt" TIMESTAMP(3),
 "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ServiceTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceMessage" (
 "id" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "externalMessageId" TEXT,
 "direction" "ServiceMessageDirection" NOT NULL DEFAULT 'INBOUND',
 "fromName" TEXT,
 "fromEmail" TEXT NOT NULL,
 "toEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
 "ccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
 "subject" TEXT,
 "textBody" TEXT,
 "htmlBody" TEXT,
 "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServiceMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceAttachment" (
 "id" TEXT NOT NULL,
 "messageId" TEXT NOT NULL,
 "externalAttachmentId" TEXT,
 "name" TEXT NOT NULL,
 "mimeType" TEXT,
 "size" INTEGER,
 "storagePath" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServiceAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServiceTicketHistory" (
 "id" TEXT NOT NULL,
 "ticketId" TEXT NOT NULL,
 "userId" TEXT,
 "type" TEXT NOT NULL,
 "message" TEXT NOT NULL,
 "metadata" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ServiceTicketHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailConnection_organizationId_provider_email_key" ON "EmailConnection"("organizationId","provider","email");
CREATE INDEX "EmailConnection_organizationId_active_idx" ON "EmailConnection"("organizationId","active");
CREATE UNIQUE INDEX "ClientEmailIdentity_clientId_normalizedEmail_key" ON "ClientEmailIdentity"("clientId","normalizedEmail");
CREATE INDEX "ClientEmailIdentity_normalizedEmail_active_idx" ON "ClientEmailIdentity"("normalizedEmail","active");
CREATE INDEX "ServiceTicket_organizationId_status_updatedAt_idx" ON "ServiceTicket"("organizationId","status","updatedAt");
CREATE INDEX "ServiceTicket_assignedToId_status_updatedAt_idx" ON "ServiceTicket"("assignedToId","status","updatedAt");
CREATE INDEX "ServiceTicket_clientId_updatedAt_idx" ON "ServiceTicket"("clientId","updatedAt");
CREATE INDEX "ServiceTicket_senderEmail_idx" ON "ServiceTicket"("senderEmail");
CREATE UNIQUE INDEX "ServiceTicket_organizationId_externalThreadId_key" ON "ServiceTicket"("organizationId","externalThreadId");
CREATE INDEX "ServiceMessage_ticketId_receivedAt_idx" ON "ServiceMessage"("ticketId","receivedAt");
CREATE UNIQUE INDEX "ServiceMessage_ticketId_externalMessageId_key" ON "ServiceMessage"("ticketId","externalMessageId");
CREATE INDEX "ServiceAttachment_messageId_idx" ON "ServiceAttachment"("messageId");
CREATE INDEX "ServiceTicketHistory_ticketId_createdAt_idx" ON "ServiceTicketHistory"("ticketId","createdAt");
CREATE INDEX "ServiceTicketHistory_userId_createdAt_idx" ON "ServiceTicketHistory"("userId","createdAt");

ALTER TABLE "EmailConnection" ADD CONSTRAINT "EmailConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientEmailIdentity" ADD CONSTRAINT "ClientEmailIdentity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceMessage" ADD CONSTRAINT "ServiceMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ServiceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAttachment" ADD CONSTRAINT "ServiceAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ServiceMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceTicketHistory" ADD CONSTRAINT "ServiceTicketHistory_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ServiceTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceTicketHistory" ADD CONSTRAINT "ServiceTicketHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
