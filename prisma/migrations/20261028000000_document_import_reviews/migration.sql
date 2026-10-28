CREATE TABLE IF NOT EXISTS "DocumentImportReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'REVIEW',
  "version" INTEGER NOT NULL DEFAULT 1,
  "simulation" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentImportReview_organizationId_clientId_kind_fingerprint_key" ON "DocumentImportReview"("organizationId", "clientId", "kind", "fingerprint");
CREATE INDEX IF NOT EXISTS "DocumentImportReview_organizationId_kind_updatedAt_idx" ON "DocumentImportReview"("organizationId", "kind", "updatedAt");
