CREATE TABLE IF NOT EXISTS "DocumentImportBuyer" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "document" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "personId" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentImportBuyer_organizationId_clientId_document_key" ON "DocumentImportBuyer"("organizationId", "clientId", "document");
