ALTER TABLE "TeamMeeting" ADD COLUMN IF NOT EXISTS "fathomEnabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "FathomConnection" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "callbackId" TEXT NOT NULL UNIQUE, "encryptedApiKey" TEXT NOT NULL, "encryptedWebhookSecret" TEXT NOT NULL, "webhookId" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "syncCursor" TEXT, "syncFrom" TIMESTAMP(3) NOT NULL,
 "lastSyncAt" TIMESTAMP(3), "syncClaimedAt" TIMESTAMP(3), "error" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FathomConnection_organizationId_userId_key" ON "FathomConnection"("organizationId","userId");
CREATE INDEX IF NOT EXISTS "FathomConnection_enabled_lastSyncAt_idx" ON "FathomConnection"("enabled","lastSyncAt");
CREATE TABLE IF NOT EXISTS "FathomRecording" (
 "id" TEXT PRIMARY KEY, "meetingId" TEXT NOT NULL REFERENCES "TeamMeeting"("id") ON DELETE CASCADE,
 "connectionId" TEXT NOT NULL REFERENCES "FathomConnection"("id") ON DELETE CASCADE,
 "recordingId" INTEGER NOT NULL, "title" TEXT NOT NULL, "playbackUrl" TEXT NOT NULL, "startsAt" TIMESTAMP(3) NOT NULL,
 "transcript" TEXT NOT NULL DEFAULT '', "summary" TEXT NOT NULL DEFAULT '', "actionItems" TEXT NOT NULL DEFAULT '', "downloadId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FathomRecording_connectionId_recordingId_key" ON "FathomRecording"("connectionId","recordingId");
CREATE INDEX IF NOT EXISTS "FathomRecording_meetingId_idx" ON "FathomRecording"("meetingId");
ALTER TABLE "FathomConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FathomRecording" ENABLE ROW LEVEL SECURITY;
