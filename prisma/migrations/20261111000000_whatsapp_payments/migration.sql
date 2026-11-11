ALTER TYPE "ContaAzulFinancialExportModule" ADD VALUE IF NOT EXISTS 'WHATSAPP';
CREATE TABLE IF NOT EXISTS "WhatsAppPaymentRequest" (
 "messageId" TEXT PRIMARY KEY REFERENCES "ServiceMessage"(id) ON DELETE CASCADE,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "ticketId" TEXT NOT NULL REFERENCES "ServiceTicket"(id) ON DELETE CASCADE,
 "accountRecipient" TEXT NOT NULL, reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', "checkedById" TEXT, "checkedAt" TIMESTAMP(3),
 "exportId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WhatsAppPaymentRequest_pending_idx" ON "WhatsAppPaymentRequest"("organizationId","accountRecipient",status,"createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppPaymentRequest_ticket_idx" ON "WhatsAppPaymentRequest"("ticketId",status);
