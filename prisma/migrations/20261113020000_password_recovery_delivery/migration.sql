CREATE TABLE IF NOT EXISTS "PasswordRecoveryRequest" (
 "id" TEXT PRIMARY KEY,
 "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
 "recipientHash" TEXT NOT NULL,
 "ipHash" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING',
 "encryptedToken" TEXT,
 "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseUntil" TIMESTAMP(3),
 "sentAt" TIMESTAMP(3),
 "lastErrorCode" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "PasswordRecoveryRequest_recipientHash_createdAt_idx" ON "PasswordRecoveryRequest"("recipientHash","createdAt");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryRequest_ipHash_createdAt_idx" ON "PasswordRecoveryRequest"("ipHash","createdAt");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryRequest_createdAt_idx" ON "PasswordRecoveryRequest"("createdAt");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryRequest_status_nextAttemptAt_idx" ON "PasswordRecoveryRequest"("status","nextAttemptAt");
CREATE INDEX IF NOT EXISTS "PasswordRecoveryRequest_userId_idx" ON "PasswordRecoveryRequest"("userId");
ALTER TABLE "PasswordRecoveryRequest" ENABLE ROW LEVEL SECURITY;
