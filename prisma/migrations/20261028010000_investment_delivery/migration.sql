CREATE TABLE IF NOT EXISTS "DocumentImportDelivery" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "clientId" TEXT NOT NULL,
 "reviewId" TEXT NOT NULL REFERENCES "DocumentImportReview"("id") ON DELETE RESTRICT,
 "rowKey" TEXT NOT NULL, "businessKey" TEXT NOT NULL UNIQUE, "marker" TEXT NOT NULL UNIQUE,
 "payload" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "saleNumber" INTEGER,
 "saleId" TEXT, "installmentId" TEXT, "settlementId" TEXT, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "DocumentImportDelivery_organizationId_clientId_reviewId_idx" ON "DocumentImportDelivery"("organizationId", "clientId", "reviewId");
CREATE TABLE IF NOT EXISTS "DocumentImportDispatchLease" (
 "clientId" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "token" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
