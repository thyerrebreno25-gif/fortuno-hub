CREATE TABLE IF NOT EXISTS "ExecutiveReportView" (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "createdById" TEXT NOT NULL,
 "sourceKey" TEXT NOT NULL,
 "tokenHash" TEXT NOT NULL UNIQUE,
 snapshot JSONB NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "revokedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("organizationId","sourceKey")
);
CREATE INDEX IF NOT EXISTS "ExecutiveReportView_expiry_idx" ON "ExecutiveReportView" ("expiresAt");
ALTER TABLE "ExecutiveReportView" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ExecutiveReportView" FROM anon,authenticated;
