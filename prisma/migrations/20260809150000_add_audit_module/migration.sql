-- Fortuno Hub - Auditoria Inteligente V1
-- Migration aditiva: cria apenas estruturas novas de auditoria.

CREATE TYPE "AuditStatus" AS ENUM ('DRAFT', 'ANALYZED', 'IN_REVIEW', 'SENT_TO_CORRECTION', 'PENDING_VALIDATION', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AuditFileType" AS ENUM ('MOVEMENTS', 'DRE', 'REVENUE_ANALYSIS', 'CASH_FLOW', 'RECEIVABLES', 'PAYABLES', 'BANK_STATEMENT', 'ACQUIRER', 'CARD_INVOICE', 'OTHER');
CREATE TYPE "AuditFindingSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');
CREATE TYPE "AuditFindingStatus" AS ENUM ('IDENTIFIED', 'DISMISSED', 'SENT', 'IN_PROGRESS', 'PENDING_VALIDATION', 'VALIDATED', 'RETURNED');
CREATE TYPE "AuditFindingSource" AS ENUM ('AUTOMATIC', 'SUPERVISOR_CHECKLIST');
CREATE TYPE "AuditChecklistStatus" AS ENUM ('PENDING', 'COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE');

CREATE TABLE "Audit" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "supervisorId" TEXT NOT NULL,
  "status" "AuditStatus" NOT NULL DEFAULT 'DRAFT',
  "referenceLabel" TEXT,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "healthScore" INTEGER NOT NULL DEFAULT 100,
  "totalChecks" INTEGER NOT NULL DEFAULT 0,
  "passedChecks" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditFile" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "type" "AuditFileType" NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT,
  "size" INTEGER,
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "parsedSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditFinding" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "source" "AuditFindingSource" NOT NULL DEFAULT 'AUTOMATIC',
  "ruleCode" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "AuditFindingSeverity" NOT NULL,
  "status" "AuditFindingStatus" NOT NULL DEFAULT 'IDENTIFIED',
  "subject" TEXT,
  "category" TEXT,
  "competence" TEXT,
  "amount" DECIMAL(18,2),
  "evidence" JSONB,
  "operatorId" TEXT,
  "supervisorNote" TEXT,
  "dueAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "validatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditInteraction" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditInteraction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditChecklistItem" (
  "id" TEXT NOT NULL,
  "auditId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "mandatory" BOOLEAN NOT NULL DEFAULT true,
  "status" "AuditChecklistStatus" NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuditChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Audit_organizationId_status_createdAt_idx" ON "Audit"("organizationId", "status", "createdAt");
CREATE INDEX "Audit_clientId_createdAt_idx" ON "Audit"("clientId", "createdAt");
CREATE INDEX "Audit_supervisorId_status_idx" ON "Audit"("supervisorId", "status");
CREATE INDEX "AuditFile_auditId_type_idx" ON "AuditFile"("auditId", "type");
CREATE INDEX "AuditFinding_auditId_status_severity_idx" ON "AuditFinding"("auditId", "status", "severity");
CREATE INDEX "AuditFinding_operatorId_status_dueAt_idx" ON "AuditFinding"("operatorId", "status", "dueAt");
CREATE INDEX "AuditInteraction_findingId_createdAt_idx" ON "AuditInteraction"("findingId", "createdAt");
CREATE INDEX "AuditInteraction_userId_createdAt_idx" ON "AuditInteraction"("userId", "createdAt");
CREATE UNIQUE INDEX "AuditChecklistItem_auditId_position_key" ON "AuditChecklistItem"("auditId", "position");
CREATE INDEX "AuditChecklistItem_auditId_status_idx" ON "AuditChecklistItem"("auditId", "status");

ALTER TABLE "Audit" ADD CONSTRAINT "Audit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditFile" ADD CONSTRAINT "AuditFile_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditFinding" ADD CONSTRAINT "AuditFinding_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditInteraction" ADD CONSTRAINT "AuditInteraction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "AuditFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditInteraction" ADD CONSTRAINT "AuditInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditChecklistItem" ADD CONSTRAINT "AuditChecklistItem_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditChecklistItem" ADD CONSTRAINT "AuditChecklistItem_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
