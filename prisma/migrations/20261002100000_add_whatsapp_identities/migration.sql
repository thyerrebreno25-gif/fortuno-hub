CREATE TABLE "ClientWhatsAppIdentity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CONTACT',
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientWhatsAppIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientWhatsAppIdentity_organizationId_clientId_kind_externalId_key"
ON "ClientWhatsAppIdentity"("organizationId", "clientId", "kind", "externalId");

CREATE INDEX "ClientWhatsAppIdentity_organizationId_kind_externalId_active_idx"
ON "ClientWhatsAppIdentity"("organizationId", "kind", "externalId", "active");

CREATE INDEX "ClientWhatsAppIdentity_clientId_active_idx"
ON "ClientWhatsAppIdentity"("clientId", "active");

ALTER TABLE "ClientWhatsAppIdentity"
ADD CONSTRAINT "ClientWhatsAppIdentity_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClientWhatsAppIdentity"
ADD CONSTRAINT "ClientWhatsAppIdentity_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
