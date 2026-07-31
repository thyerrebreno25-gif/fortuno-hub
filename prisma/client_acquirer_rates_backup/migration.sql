CREATE TYPE "AcquirerTransactionType" AS ENUM ('DEBIT', 'CREDIT', 'PIX', 'VOUCHER', 'OTHER');

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
    CONSTRAINT "ClientAcquirerRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientAcquirerRate_clientAcquirerId_transactionType_installments_normalizedBrand_key"
ON "ClientAcquirerRate"("clientAcquirerId", "transactionType", "installments", "normalizedBrand");
CREATE INDEX "ClientAcquirerRate_clientAcquirerId_active_idx" ON "ClientAcquirerRate"("clientAcquirerId", "active");
ALTER TABLE "ClientAcquirerRate" ADD CONSTRAINT "ClientAcquirerRate_clientAcquirerId_fkey"
FOREIGN KEY ("clientAcquirerId") REFERENCES "ClientAcquirer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
