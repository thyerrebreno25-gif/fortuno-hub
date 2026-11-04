CREATE TABLE IF NOT EXISTS "MeetingReport" (
 "id" TEXT PRIMARY KEY, "meetingId" TEXT NOT NULL REFERENCES "TeamMeeting"("id") ON DELETE CASCADE,
 "requestedById" TEXT NOT NULL, "includeRecordings" BOOLEAN NOT NULL DEFAULT true, "generation" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "content" TEXT NOT NULL DEFAULT '', "sourceHash" TEXT NOT NULL DEFAULT '', "mode" TEXT,
 "work" JSONB, "error" TEXT, "claimedAt" TIMESTAMP(3), "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "generatedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MeetingReport_meetingId_key" ON "MeetingReport"("meetingId");
CREATE INDEX IF NOT EXISTS "MeetingReport_status_nextRunAt_idx" ON "MeetingReport"("status","nextRunAt");

ALTER TABLE "MeetingReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppDirectoryEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsAppDirectorySync" ENABLE ROW LEVEL SECURITY;
