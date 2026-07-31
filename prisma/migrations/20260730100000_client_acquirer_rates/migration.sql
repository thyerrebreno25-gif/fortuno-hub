-- Remove a tabela eventualmente criada parcialmente pela tentativa anterior.
-- Esta migration ainda não foi aplicada com sucesso, portanto não há dados válidos a preservar nela.
DROP TABLE IF EXISTS "ClientAcquirerRate" CASCADE;

-- Cria o enum apenas se ele ainda não existir.
DO $$
BEGIN
  CREATE TYPE "AcquirerTransactionType" AS ENUM (
    'DEBIT',
    'CREDIT',
    'PIX',
    'VOUCHER',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE "ClientAcquirerRate" (
  "id" TEXT NOT NULL,
  "clientAcquirerId" TEXT NOT NULL,
  "transactionType" "AcquirerTransactionType" NOT NULL,
  "installments" INTEGER NOT NULL DEFAULT 1,
  "brand" TEXT,
  "normalizedBrand" TEXT,
  "expectedRate" DECIMAL(7,4) NOT NULL,
  "tolerance" DECIMAL(7,4) NOT NULL DEFAULT 0.01,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClientAcquirerRate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClientAcquirerRate_clientAcquirerId_fkey"
    FOREIGN KEY ("clientAcquirerId")
    REFERENCES "ClientAcquirer"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "ClientAcquirerRate_expectedRate_check"
    CHECK ("expectedRate" >= 0 AND "expectedRate" <= 100),
  CONSTRAINT "ClientAcquirerRate_tolerance_check"
    CHECK ("tolerance" >= 0 AND "tolerance" <= 100),
  CONSTRAINT "ClientAcquirerRate_installments_check"
    CHECK ("installments" >= 1 AND "installments" <= 36)
);

CREATE UNIQUE INDEX "ClientAcquirerRate_clientAcquirerId_transactionType_installments_normalizedBrand_key"
  ON "ClientAcquirerRate"(
    "clientAcquirerId",
    "transactionType",
    "installments",
    "normalizedBrand"
  );

CREATE INDEX "ClientAcquirerRate_clientAcquirerId_active_idx"
  ON "ClientAcquirerRate"("clientAcquirerId", "active");
