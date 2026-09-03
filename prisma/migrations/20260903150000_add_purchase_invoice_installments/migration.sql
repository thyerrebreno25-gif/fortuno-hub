CREATE TYPE "PurchaseInvoiceInstallmentSource" AS ENUM ('XML', 'MANUAL_REQUIRED', 'MANUAL');

CREATE TABLE "PurchaseInvoiceInstallment" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "installmentNumber" INTEGER NOT NULL,
  "externalNumber" TEXT,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "source" "PurchaseInvoiceInstallmentSource" NOT NULL DEFAULT 'MANUAL_REQUIRED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoiceInstallment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseInvoiceInstallment_invoiceId_installmentNumber_key"
  ON "PurchaseInvoiceInstallment"("invoiceId", "installmentNumber");

CREATE INDEX "PurchaseInvoiceInstallment_invoiceId_dueDate_idx"
  ON "PurchaseInvoiceInstallment"("invoiceId", "dueDate");

ALTER TABLE "PurchaseInvoiceInstallment"
  ADD CONSTRAINT "PurchaseInvoiceInstallment_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PurchaseInvoiceInstallment" (
  "id",
  "invoiceId",
  "installmentNumber",
  "dueDate",
  "amount",
  "source",
  "createdAt",
  "updatedAt"
)
SELECT
  'legacy-' || "id",
  "id",
  1,
  "dueDate",
  "totalInvoice",
  'MANUAL_REQUIRED'::"PurchaseInvoiceInstallmentSource",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "PurchaseInvoice";
