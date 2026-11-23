ALTER TABLE "OperationActivity" ADD COLUMN IF NOT EXISTS "disregardReview" JSONB;
CREATE INDEX IF NOT EXISTS "OperationActivity_pending_disregard" ON "OperationActivity" ("organizationId") WHERE "deletedAt" IS NULL AND "disregardReview"->>'status'='PENDING';
