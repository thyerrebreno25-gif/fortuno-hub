-- Separa os apontamentos automáticos entre Contas a Pagar e Contas a Receber.
CREATE TYPE "AuditFinancialFlow" AS ENUM ('PAYABLE', 'RECEIVABLE', 'GENERAL');

ALTER TABLE "AuditFinding"
ADD COLUMN "flow" "AuditFinancialFlow" NOT NULL DEFAULT 'GENERAL';

DROP INDEX IF EXISTS "AuditFinding_auditId_status_severity_idx";
CREATE INDEX "AuditFinding_auditId_flow_status_severity_idx"
ON "AuditFinding"("auditId", "flow", "status", "severity");
