CREATE TYPE "ContaAzulFinancialExportModule" AS ENUM ('CREDIT_CARD_INVOICE', 'ACQUIRER');
CREATE TYPE "ContaAzulFinancialExportStatus" AS ENUM ('PROCESSING', 'PARTIAL', 'COMPLETED', 'FAILED');
CREATE TYPE "ContaAzulFinancialExportLineStatus" AS ENUM ('PENDING', 'CREATED', 'SETTLED', 'FAILED');
CREATE TYPE "ContaAzulFinancialDirection" AS ENUM ('PAYABLE', 'RECEIVABLE');

CREATE TABLE "ContaAzulFinancialExport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "module" "ContaAzulFinancialExportModule" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactName" TEXT,
    "financialAccountId" TEXT NOT NULL,
    "financialAccountName" TEXT,
    "settleRequested" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContaAzulFinancialExportStatus" NOT NULL DEFAULT 'PROCESSING',
    "lastError" TEXT,
    "metadata" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContaAzulFinancialExport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContaAzulFinancialExportLine" (
    "id" TEXT NOT NULL,
    "exportId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "direction" "ContaAzulFinancialDirection" NOT NULL,
    "status" "ContaAzulFinancialExportLineStatus" NOT NULL DEFAULT 'PENDING',
    "competenceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "categoryName" TEXT NOT NULL,
    "contaAzulCategoryId" TEXT,
    "costCenterName" TEXT,
    "contaAzulCostCenterId" TEXT,
    "externalProtocolId" TEXT,
    "externalEventId" TEXT,
    "externalInstallmentId" TEXT,
    "externalSettlementId" TEXT,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContaAzulFinancialExportLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContaAzulFinancialExport_clientId_module_sourceKey_key" ON "ContaAzulFinancialExport"("clientId", "module", "sourceKey");
CREATE INDEX "ContaAzulFinancialExport_organizationId_module_createdAt_idx" ON "ContaAzulFinancialExport"("organizationId", "module", "createdAt");
CREATE INDEX "ContaAzulFinancialExport_clientId_status_idx" ON "ContaAzulFinancialExport"("clientId", "status");
CREATE UNIQUE INDEX "ContaAzulFinancialExportLine_exportId_lineKey_key" ON "ContaAzulFinancialExportLine"("exportId", "lineKey");
CREATE INDEX "ContaAzulFinancialExportLine_exportId_status_idx" ON "ContaAzulFinancialExportLine"("exportId", "status");
CREATE INDEX "ContaAzulFinancialExportLine_externalProtocolId_idx" ON "ContaAzulFinancialExportLine"("externalProtocolId");

ALTER TABLE "ContaAzulFinancialExport" ADD CONSTRAINT "ContaAzulFinancialExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContaAzulFinancialExport" ADD CONSTRAINT "ContaAzulFinancialExport_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContaAzulFinancialExport" ADD CONSTRAINT "ContaAzulFinancialExport_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ContaAzulConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContaAzulFinancialExport" ADD CONSTRAINT "ContaAzulFinancialExport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContaAzulFinancialExportLine" ADD CONSTRAINT "ContaAzulFinancialExportLine_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "ContaAzulFinancialExport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
