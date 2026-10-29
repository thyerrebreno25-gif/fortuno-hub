ALTER TABLE "DocumentImportDelivery" ADD COLUMN IF NOT EXISTS "contractId" TEXT;
ALTER TABLE "DocumentImportDelivery" ADD COLUMN IF NOT EXISTS "contractNumber" INTEGER;
