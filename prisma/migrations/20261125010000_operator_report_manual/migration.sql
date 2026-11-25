CREATE TABLE IF NOT EXISTS "OperatorReportManualDelivery" (
 "organizationId" TEXT NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
 "requestId" UUID NOT NULL, "requestedById" TEXT NOT NULL, day TEXT NOT NULL,
 "configRevision" TEXT NOT NULL, "destinationName" TEXT NOT NULL,
 snapshot JSONB NOT NULL, messages JSONB NOT NULL,
 status TEXT NOT NULL DEFAULT 'READY', attempts INTEGER NOT NULL DEFAULT 0,
 "pdfBase64" TEXT, "attachmentRef" JSONB, "leaseId" UUID, "leaseUntil" TIMESTAMP(3),
 "lastError" TEXT, "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("organizationId","requestId")
);
CREATE INDEX IF NOT EXISTS "OperatorReportManualDelivery_active_idx" ON "OperatorReportManualDelivery" ("organizationId",status,"leaseUntil");
ALTER TABLE "OperatorReportManualDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "OperatorReportManualDelivery" FROM PUBLIC;
DO $security$
DECLARE api_role TEXT;
BEGIN
 FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
   EXECUTE format('REVOKE ALL ON TABLE "OperatorReportManualDelivery" FROM %I',api_role);
  END IF;
 END LOOP;
END
$security$;
