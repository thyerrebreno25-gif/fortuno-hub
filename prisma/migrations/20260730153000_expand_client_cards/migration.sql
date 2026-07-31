ALTER TABLE "ClientCard"
ADD COLUMN "bankName" TEXT,
ADD COLUMN "normalizedBankName" TEXT,
ADD COLUMN "lastFourDigits" TEXT,
ADD COLUMN "nickname" TEXT;

UPDATE "ClientCard"
SET
  "bankName" = 'NÃO INFORMADO',
  "normalizedBankName" = 'NAO INFORMADO'
WHERE "bankName" IS NULL OR "normalizedBankName" IS NULL;

ALTER TABLE "ClientCard"
ALTER COLUMN "bankName" SET NOT NULL,
ALTER COLUMN "normalizedBankName" SET NOT NULL;

DROP INDEX IF EXISTS "ClientCard_clientId_brand_key";
CREATE UNIQUE INDEX "ClientCard_clientId_normalizedBankName_brand_lastFourDigits_key"
ON "ClientCard"("clientId", "normalizedBankName", "brand", "lastFourDigits");

CREATE INDEX "ClientCard_clientId_normalizedBankName_active_idx"
ON "ClientCard"("clientId", "normalizedBankName", "active");
