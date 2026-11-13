ALTER TABLE "TeamMeeting" ADD COLUMN IF NOT EXISTS "responsibleId" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "TeamMeeting" ADD COLUMN IF NOT EXISTS "creationKey" TEXT;
ALTER TABLE "TeamMeeting" ADD COLUMN IF NOT EXISTS "creationHash" TEXT;
ALTER TABLE "TeamMeeting" ADD COLUMN IF NOT EXISTS "recurrenceData" JSONB;
CREATE INDEX IF NOT EXISTS "TeamMeeting_organizationId_creationKey_idx" ON "TeamMeeting"("organizationId", "creationKey");
CREATE INDEX IF NOT EXISTS "TeamMeeting_responsibleId_idx" ON "TeamMeeting"("responsibleId");
CREATE UNIQUE INDEX IF NOT EXISTS "TeamMeeting_organizationId_creationKey_startsAt_key" ON "TeamMeeting"("organizationId", "creationKey", "startsAt");
