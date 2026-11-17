-- Each configuration owns its activities; allow independent schedules per process.
-- Exact-repeat protection is serialized per client/process in the creation route.
ALTER TABLE "OperationClientProcess" DROP CONSTRAINT IF EXISTS "OperationClientProcess_clientId_processId_key";
DROP INDEX IF EXISTS "OperationClientProcess_clientId_processId_key";
CREATE INDEX IF NOT EXISTS "OperationClientProcess_clientId_processId_idx" ON "OperationClientProcess"("clientId", "processId");
