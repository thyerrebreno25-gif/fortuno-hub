ALTER TABLE "OperatorReportConfig" ADD COLUMN IF NOT EXISTS "spaceName" TEXT;
ALTER TABLE "OperatorReportConfig" ALTER COLUMN "webhookEncrypted" SET DEFAULT '';
-- A webhook-only setup cannot upload PDFs. Require the explicit Chat connection.
UPDATE "OperatorReportConfig" SET enabled=false WHERE "spaceName" IS NULL AND enabled=true;
ALTER TABLE "OperatorReportDelivery" ADD COLUMN IF NOT EXISTS "pdfBase64" TEXT;
ALTER TABLE "OperatorReportDelivery" ADD COLUMN IF NOT EXISTS "attachmentRef" JSONB;
CREATE TABLE IF NOT EXISTS "OperatorReportGoogleConnection" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "userId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "encryptedAccessToken" TEXT NOT NULL, "encryptedRefreshToken" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, provider TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'CONNECTED', "lastError" TEXT,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("organizationId","userId")
);
