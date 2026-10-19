CREATE TABLE IF NOT EXISTS "OperationalMapping" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "clientId" TEXT REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "objective" TEXT NOT NULL DEFAULT '',
  "owner" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "data" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "OperationalMapping_organizationId_updatedAt_idx" ON "OperationalMapping"("organizationId", "updatedAt");
CREATE INDEX IF NOT EXISTS "OperationalMapping_clientId_idx" ON "OperationalMapping"("clientId");
ALTER TABLE "OperationalMapping" ENABLE ROW LEVEL SECURITY;
