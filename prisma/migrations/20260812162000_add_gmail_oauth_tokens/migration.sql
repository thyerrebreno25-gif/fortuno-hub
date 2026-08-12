ALTER TABLE "EmailConnection"
ADD COLUMN "encryptedAccessToken" TEXT,
ADD COLUMN "encryptedRefreshToken" TEXT,
ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
