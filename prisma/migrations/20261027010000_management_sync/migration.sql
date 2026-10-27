CREATE TABLE IF NOT EXISTS "ManagementSyncState" (
  "id" TEXT PRIMARY KEY,
  "origin" TEXT NOT NULL,
  "configuredAt" TIMESTAMP(3),
  "setupError" TEXT,
  "lastStartedAt" TIMESTAMP(3),
  "lastFinishedAt" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "processed" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT
);
ALTER TABLE "ManagementSyncState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClientManagement" ENABLE ROW LEVEL SECURITY;
