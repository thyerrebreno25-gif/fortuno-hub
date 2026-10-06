ALTER TABLE "ServiceMessage"
ADD COLUMN "deliveryStatus" TEXT,
ADD COLUMN "statusUpdatedAt" TIMESTAMP(3),
ADD COLUMN "providerMetadata" JSONB;

CREATE INDEX "ServiceMessage_externalMessageId_idx"
ON "ServiceMessage"("externalMessageId");
