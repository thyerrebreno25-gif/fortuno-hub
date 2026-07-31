ALTER TABLE "Onboarding" ALTER COLUMN "clientId" DROP NOT NULL;

ALTER TABLE "Onboarding"
  ADD COLUMN IF NOT EXISTS "companyName" TEXT,
  ADD COLUMN IF NOT EXISTS "tradeName" TEXT,
  ADD COLUMN IF NOT EXISTS "cnpj" TEXT,
  ADD COLUMN IF NOT EXISTS "contactName" TEXT,
  ADD COLUMN IF NOT EXISTS "contactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "contactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "supervisor" TEXT,
  ADD COLUMN IF NOT EXISTS "analystLead" TEXT,
  ADD COLUMN IF NOT EXISTS "team" TEXT,
  ADD COLUMN IF NOT EXISTS "responsibleName" TEXT,
  ADD COLUMN IF NOT EXISTS "projectData" JSONB;

ALTER TABLE "Onboarding" DROP CONSTRAINT IF EXISTS "Onboarding_clientId_fkey";
ALTER TABLE "Onboarding"
  ADD CONSTRAINT "Onboarding_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Onboarding_organizationId_cnpj_idx"
  ON "Onboarding"("organizationId", "cnpj");
