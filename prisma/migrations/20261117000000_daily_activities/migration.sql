ALTER TABLE "MeetingActionItem" ADD COLUMN IF NOT EXISTS "originalDueAt" TIMESTAMP(3);
ALTER TABLE "MeetingActionItem" ADD COLUMN IF NOT EXISTS "autoExtendedAt" TIMESTAMP(3);
ALTER TABLE "MeetingActionItem" ADD COLUMN IF NOT EXISTS "overdueNoticeId" TEXT;
CREATE INDEX IF NOT EXISTS "MeetingActionItem_completedAt_dueAt_idx" ON "MeetingActionItem" ("completedAt", "dueAt");
ALTER TABLE "MeetingNote" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MeetingNote" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
ALTER TABLE "MeetingNote" ADD COLUMN IF NOT EXISTS "reactions" JSONB NOT NULL DEFAULT '{}';
