ALTER TABLE "WhatsAppPaymentRequest" ADD COLUMN IF NOT EXISTS "clearedAt" TIMESTAMP(3);
ALTER TABLE "WhatsAppPaymentRequest" ADD COLUMN IF NOT EXISTS "clearedById" TEXT;
ALTER TABLE "WhatsAppPaymentRequest" ADD COLUMN IF NOT EXISTS "clearedBatchId" TEXT;
CREATE INDEX IF NOT EXISTS "WhatsAppPaymentRequest_visible_idx" ON "WhatsAppPaymentRequest"("organizationId","accountRecipient",status,"createdAt") WHERE "clearedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "WhatsAppPaymentRequest_cleanup_idx" ON "WhatsAppPaymentRequest"("organizationId","accountRecipient","clearedBatchId") WHERE "clearedAt" IS NOT NULL;
