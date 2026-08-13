BEGIN;

DO $$
BEGIN
  CREATE TYPE "ClientSquad" AS ENUM ('SQUAD_1', 'SQUAD_2');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE TYPE "ServiceRoutingArea" AS ENUM (
    'ACCOUNTS_PAYABLE',
    'ACCOUNTS_RECEIVABLE',
    'GENERAL',
    'UNKNOWN'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "serviceSquad" "ClientSquad",
  ADD COLUMN IF NOT EXISTS "payableResponsibleId" TEXT,
  ADD COLUMN IF NOT EXISTS "receivableResponsibleId" TEXT,
  ADD COLUMN IF NOT EXISTS "generalResponsibleId" TEXT,
  ADD COLUMN IF NOT EXISTS "serviceAliases" TEXT;

ALTER TABLE "ServiceTicket"
  ADD COLUMN IF NOT EXISTS "routingArea" "ServiceRoutingArea" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "routingSquad" "ClientSquad",
  ADD COLUMN IF NOT EXISTS "routingConfidence" INTEGER,
  ADD COLUMN IF NOT EXISTS "routingReason" TEXT;

CREATE INDEX IF NOT EXISTS "Client_payableResponsibleId_idx"
  ON "Client"("payableResponsibleId");

CREATE INDEX IF NOT EXISTS "Client_receivableResponsibleId_idx"
  ON "Client"("receivableResponsibleId");

CREATE INDEX IF NOT EXISTS "Client_generalResponsibleId_idx"
  ON "Client"("generalResponsibleId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Client_payableResponsibleId_fkey'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_payableResponsibleId_fkey"
      FOREIGN KEY ("payableResponsibleId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Client_receivableResponsibleId_fkey'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_receivableResponsibleId_fkey"
      FOREIGN KEY ("receivableResponsibleId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'Client_generalResponsibleId_fkey'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_generalResponsibleId_fkey"
      FOREIGN KEY ("generalResponsibleId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;
