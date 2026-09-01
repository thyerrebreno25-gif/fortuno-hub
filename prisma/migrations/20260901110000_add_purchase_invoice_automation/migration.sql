CREATE TYPE "ContaAzulConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "PurchaseInvoiceSource" AS ENUM ('XML_UPLOAD', 'CONTA_AZUL');
CREATE TYPE "PurchaseInvoiceStatus" AS ENUM ('PENDING_REVIEW', 'READY_TO_SEND', 'SENT', 'FAILED', 'IGNORED');

CREATE TABLE "ContaAzulConnection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "status" "ContaAzulConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "encryptedAccessToken" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "externalTenantId" TEXT,
  "externalTenantName" TEXT,
  "connectedByUserId" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "lastError" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContaAzulConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseInvoice" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "connectionId" TEXT,
  "createdById" TEXT NOT NULL,
  "source" "PurchaseInvoiceSource" NOT NULL DEFAULT 'XML_UPLOAD',
  "sourceKey" TEXT NOT NULL,
  "accessKey" TEXT,
  "number" TEXT NOT NULL,
  "series" TEXT,
  "supplierName" TEXT NOT NULL,
  "supplierDocument" TEXT,
  "supplierContaAzulId" TEXT,
  "supplierContaAzulName" TEXT,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "competenceDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "totalProducts" DECIMAL(18,2) NOT NULL,
  "totalInvoice" DECIMAL(18,2) NOT NULL,
  "financialAccountId" TEXT,
  "financialAccountName" TEXT,
  "paymentMethod" TEXT NOT NULL DEFAULT 'OUTRO',
  "status" "PurchaseInvoiceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "externalPurchaseId" TEXT,
  "externalPayableProtocolId" TEXT,
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "rawXml" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseInvoiceItem" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "productCode" TEXT,
  "description" TEXT NOT NULL,
  "normalizedDescription" TEXT NOT NULL,
  "ncm" TEXT,
  "cfop" TEXT,
  "unit" TEXT,
  "quantity" DECIMAL(18,6) NOT NULL,
  "unitValue" DECIMAL(18,6) NOT NULL,
  "totalValue" DECIMAL(18,2) NOT NULL,
  "allocationAmount" DECIMAL(18,2) NOT NULL,
  "contaAzulCategoryId" TEXT,
  "contaAzulCategoryName" TEXT,
  "contaAzulCostCenterId" TEXT,
  "contaAzulCostCenterName" TEXT,
  "learned" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseInvoiceRule" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "supplierDocument" TEXT NOT NULL,
  "productCode" TEXT NOT NULL,
  "normalizedDescription" TEXT NOT NULL,
  "contaAzulCategoryId" TEXT NOT NULL,
  "contaAzulCategoryName" TEXT NOT NULL,
  "contaAzulCostCenterId" TEXT,
  "contaAzulCostCenterName" TEXT,
  "usageCount" INTEGER NOT NULL DEFAULT 1,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoiceRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContaAzulConnection_clientId_key" ON "ContaAzulConnection"("clientId");
CREATE INDEX "ContaAzulConnection_organizationId_active_idx" ON "ContaAzulConnection"("organizationId", "active");
CREATE INDEX "ContaAzulConnection_tokenExpiresAt_idx" ON "ContaAzulConnection"("tokenExpiresAt");
CREATE UNIQUE INDEX "PurchaseInvoice_clientId_sourceKey_key" ON "PurchaseInvoice"("clientId", "sourceKey");
CREATE INDEX "PurchaseInvoice_organizationId_status_createdAt_idx" ON "PurchaseInvoice"("organizationId", "status", "createdAt");
CREATE INDEX "PurchaseInvoice_clientId_issueDate_idx" ON "PurchaseInvoice"("clientId", "issueDate");
CREATE INDEX "PurchaseInvoice_accessKey_idx" ON "PurchaseInvoice"("accessKey");
CREATE UNIQUE INDEX "PurchaseInvoiceItem_invoiceId_lineNumber_key" ON "PurchaseInvoiceItem"("invoiceId", "lineNumber");
CREATE INDEX "PurchaseInvoiceItem_invoiceId_idx" ON "PurchaseInvoiceItem"("invoiceId");
CREATE INDEX "PurchaseInvoiceItem_normalizedDescription_idx" ON "PurchaseInvoiceItem"("normalizedDescription");
CREATE UNIQUE INDEX "PurchaseInvoiceRule_clientId_supplierDocument_productCode_normalizedDescription_key" ON "PurchaseInvoiceRule"("clientId", "supplierDocument", "productCode", "normalizedDescription");
CREATE INDEX "PurchaseInvoiceRule_clientId_supplierDocument_productCode_idx" ON "PurchaseInvoiceRule"("clientId", "supplierDocument", "productCode");

ALTER TABLE "ContaAzulConnection" ADD CONSTRAINT "ContaAzulConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContaAzulConnection" ADD CONSTRAINT "ContaAzulConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ContaAzulConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceRule" ADD CONSTRAINT "PurchaseInvoiceRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
