-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AcquirerReceiptRule" AS ENUM ('WITHOUT_ADVANCE', 'AUTOMATIC_ADVANCE', 'OCCASIONAL_ADVANCE');

-- CreateEnum
CREATE TYPE "public"."CategoryMappingType" AS ENUM ('SALES_REVENUE', 'MDR_FEES', 'ADVANCE_FEES', 'MACHINE_RENTAL_ADJUSTMENTS', 'SALE_CANCELLATION', 'REFUNDS_CREDITS');

-- CreateEnum
CREATE TYPE "public"."ImportModule" AS ENUM ('EXCHANGE', 'BANK_STATEMENT', 'ACQUIRER', 'CREDIT_CARD_INVOICE', 'BRASILMED_RECONCILIATION');

-- CreateEnum
CREATE TYPE "public"."ImportStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'REVIEW', 'VALIDATED', 'EXPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."OnboardingRisk" AS ENUM ('ON_TIME', 'AT_RISK', 'OVERDUE');

-- CreateEnum
CREATE TYPE "public"."OnboardingStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."OnboardingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "public"."ParserKind" AS ENUM ('BANK_STATEMENT', 'CREDIT_CARD_INVOICE', 'ACQUIRER', 'PAYROLL_RECONCILIATION');

-- CreateEnum
CREATE TYPE "public"."TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('MASTER', 'ADMIN', 'MANAGER', 'OPERATOR', 'CLIENT');

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BrasilmedReconciliationRow" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "employeeId" TEXT,
    "name" TEXT NOT NULL,
    "section" TEXT,
    "role" TEXT,
    "bankName" TEXT,
    "bankCode" TEXT,
    "account" TEXT,
    "cpf" TEXT,
    "pixKey" TEXT,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "costCenter" TEXT,
    "expenseType" TEXT,
    "category" TEXT,
    "competence" TEXT,
    "paymentDate" TIMESTAMP(3),
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "sourcePage" INTEGER,
    "sourceText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrasilmedReconciliationRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Category" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CategoryRule" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "module" "public"."ImportModule" NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "costCenter" TEXT,
    "confidence" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "normalizedName" TEXT NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientAcquirer" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "receiptRule" "public"."AcquirerReceiptRule" NOT NULL DEFAULT 'WITHOUT_ADVANCE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientAcquirer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientBank" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT,
    "agency" TEXT,
    "account" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientCard" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientCategoryMapping" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mappingType" "public"."CategoryMappingType" NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCategoryMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CostCenter" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Employee" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "cpf" TEXT,
    "registration" TEXT,
    "section" TEXT,
    "role" TEXT,
    "defaultCostCenter" TEXT,
    "defaultExpenseType" TEXT,
    "defaultCategory" TEXT,
    "contaAzulSupplierName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ExchangeRate" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "buyRate" DECIMAL(18,8) NOT NULL,
    "sellRate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BCB_PTAX',
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "userId" TEXT NOT NULL,
    "module" "public"."ImportModule" NOT NULL,
    "status" "public"."ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT,
    "parserId" TEXT,
    "parserVersion" TEXT,
    "confidence" DECIMAL(5,2),
    "expectedTotal" DECIMAL(18,2),
    "parsedTotal" DECIMAL(18,2),
    "difference" DECIMAL(18,2),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Onboarding" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT,
    "responsibleId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" "public"."OnboardingStatus" NOT NULL DEFAULT 'OPEN',
    "risk" "public"."OnboardingRisk" NOT NULL DEFAULT 'ON_TIME',
    "startDate" TIMESTAMP(3) NOT NULL,
    "expectedEndDate" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingHistory" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingTask" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "templateTaskId" TEXT,
    "responsibleId" TEXT,
    "categoryName" TEXT NOT NULL,
    "activityName" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "public"."OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "tip" TEXT,
    "isNotionReminder" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "waitingFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingTaskTemplate" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "defaultResponsibleRole" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "tip" TEXT,
    "isNotionReminder" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "slaDays" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingTemplateActivity" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplateActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingTemplateCategory" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OnboardingTimeEntry" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "seconds" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL DEFAULT 'OPERATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ParsedTransaction" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "type" "public"."TransactionType" NOT NULL,
    "document" TEXT,
    "category" TEXT,
    "costCenter" TEXT,
    "sourcePage" INTEGER,
    "sourceLine" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParsedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ParserDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "public"."ParserKind" NOT NULL,
    "institution" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "fingerprints" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParserDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ParserRun" (
    "id" TEXT NOT NULL,
    "importJobId" TEXT NOT NULL,
    "parserDefinitionId" TEXT NOT NULL,
    "confidence" DECIMAL(5,2) NOT NULL,
    "linesFound" INTEGER NOT NULL DEFAULT 0,
    "linesIgnored" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "diagnostics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParserRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SupportTicket" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" "public"."TicketStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "public"."AuditLog"("entity" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "public"."AuditLog"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "BrasilmedReconciliationRow_employeeId_idx" ON "public"."BrasilmedReconciliationRow"("employeeId" ASC);

-- CreateIndex
CREATE INDEX "BrasilmedReconciliationRow_importJobId_idx" ON "public"."BrasilmedReconciliationRow"("importJobId" ASC);

-- CreateIndex
CREATE INDEX "Category_organizationId_active_idx" ON "public"."Category"("organizationId" ASC, "active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Category_organizationId_parentId_normalizedName_key" ON "public"."Category"("organizationId" ASC, "parentId" ASC, "normalizedName" ASC);

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "public"."Category"("parentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRule_clientId_module_normalizedDescription_key" ON "public"."CategoryRule"("clientId" ASC, "module" ASC, "normalizedDescription" ASC);

-- CreateIndex
CREATE INDEX "Client_organizationId_active_idx" ON "public"."Client"("organizationId" ASC, "active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_document_key" ON "public"."Client"("organizationId" ASC, "document" ASC);

-- CreateIndex
CREATE INDEX "Client_organizationId_idx" ON "public"."Client"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Client_organizationId_normalizedName_key" ON "public"."Client"("organizationId" ASC, "normalizedName" ASC);

-- CreateIndex
CREATE INDEX "ClientAcquirer_clientId_active_idx" ON "public"."ClientAcquirer"("clientId" ASC, "active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAcquirer_clientId_normalizedName_key" ON "public"."ClientAcquirer"("clientId" ASC, "normalizedName" ASC);

-- CreateIndex
CREATE INDEX "ClientBank_clientId_active_idx" ON "public"."ClientBank"("clientId" ASC, "active" ASC);

-- CreateIndex
CREATE INDEX "ClientBank_clientId_idx" ON "public"."ClientBank"("clientId" ASC);

-- CreateIndex
CREATE INDEX "ClientCard_clientId_active_idx" ON "public"."ClientCard"("clientId" ASC, "active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ClientCard_clientId_brand_key" ON "public"."ClientCard"("clientId" ASC, "brand" ASC);

-- CreateIndex
CREATE INDEX "ClientCategoryMapping_categoryId_idx" ON "public"."ClientCategoryMapping"("categoryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ClientCategoryMapping_clientId_mappingType_key" ON "public"."ClientCategoryMapping"("clientId" ASC, "mappingType" ASC);

-- CreateIndex
CREATE INDEX "ClientCategoryMapping_subcategoryId_idx" ON "public"."ClientCategoryMapping"("subcategoryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_clientId_name_key" ON "public"."CostCenter"("clientId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "Employee_clientId_cpf_idx" ON "public"."Employee"("clientId" ASC, "cpf" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_clientId_normalizedName_key" ON "public"."Employee"("clientId" ASC, "normalizedName" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_currency_rateDate_source_key" ON "public"."ExchangeRate"("currency" ASC, "rateDate" ASC, "source" ASC);

-- CreateIndex
CREATE INDEX "ExchangeRate_rateDate_idx" ON "public"."ExchangeRate"("rateDate" ASC);

-- CreateIndex
CREATE INDEX "ImportJob_clientId_idx" ON "public"."ImportJob"("clientId" ASC);

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_module_createdAt_idx" ON "public"."ImportJob"("organizationId" ASC, "module" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Onboarding_clientId_idx" ON "public"."Onboarding"("clientId" ASC);

-- CreateIndex
CREATE INDEX "Onboarding_expectedEndDate_idx" ON "public"."Onboarding"("expectedEndDate" ASC);

-- CreateIndex
CREATE INDEX "Onboarding_organizationId_status_idx" ON "public"."Onboarding"("organizationId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "Onboarding_responsibleId_idx" ON "public"."Onboarding"("responsibleId" ASC);

-- CreateIndex
CREATE INDEX "OnboardingComment_taskId_createdAt_idx" ON "public"."OnboardingComment"("taskId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "OnboardingHistory_onboardingId_createdAt_idx" ON "public"."OnboardingHistory"("onboardingId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTask_onboardingId_position_idx" ON "public"."OnboardingTask"("onboardingId" ASC, "position" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTask_responsibleId_status_idx" ON "public"."OnboardingTask"("responsibleId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTask_status_idx" ON "public"."OnboardingTask"("status" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTaskTemplate_activityId_idx" ON "public"."OnboardingTaskTemplate"("activityId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTaskTemplate_activityId_position_key" ON "public"."OnboardingTaskTemplate"("activityId" ASC, "position" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTemplate_organizationId_active_idx" ON "public"."OnboardingTemplate"("organizationId" ASC, "active" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplate_organizationId_name_key" ON "public"."OnboardingTemplate"("organizationId" ASC, "name" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTemplateActivity_categoryId_idx" ON "public"."OnboardingTemplateActivity"("categoryId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplateActivity_categoryId_position_key" ON "public"."OnboardingTemplateActivity"("categoryId" ASC, "position" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTemplateCategory_templateId_idx" ON "public"."OnboardingTemplateCategory"("templateId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplateCategory_templateId_position_key" ON "public"."OnboardingTemplateCategory"("templateId" ASC, "position" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTimeEntry_taskId_startedAt_idx" ON "public"."OnboardingTimeEntry"("taskId" ASC, "startedAt" ASC);

-- CreateIndex
CREATE INDEX "OnboardingTimeEntry_userId_startedAt_idx" ON "public"."OnboardingTimeEntry"("userId" ASC, "startedAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_document_key" ON "public"."Organization"("document" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "public"."OrganizationMember"("organizationId" ASC, "userId" ASC);

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "public"."OrganizationMember"("userId" ASC);

-- CreateIndex
CREATE INDEX "ParsedTransaction_importJobId_date_idx" ON "public"."ParsedTransaction"("importJobId" ASC, "date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ParserDefinition_institution_layout_version_key" ON "public"."ParserDefinition"("institution" ASC, "layout" ASC, "version" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ParserRun_importJobId_key" ON "public"."ParserRun"("importJobId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrasilmedReconciliationRow" ADD CONSTRAINT "BrasilmedReconciliationRow_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BrasilmedReconciliationRow" ADD CONSTRAINT "BrasilmedReconciliationRow_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CategoryRule" ADD CONSTRAINT "CategoryRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientAcquirer" ADD CONSTRAINT "ClientAcquirer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientBank" ADD CONSTRAINT "ClientBank_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientCard" ADD CONSTRAINT "ClientCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientCategoryMapping" ADD CONSTRAINT "ClientCategoryMapping_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientCategoryMapping" ADD CONSTRAINT "ClientCategoryMapping_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientCategoryMapping" ADD CONSTRAINT "ClientCategoryMapping_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "public"."Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CostCenter" ADD CONSTRAINT "CostCenter_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportJob" ADD CONSTRAINT "ImportJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ImportJob" ADD CONSTRAINT "ImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Onboarding" ADD CONSTRAINT "Onboarding_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Onboarding" ADD CONSTRAINT "Onboarding_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Onboarding" ADD CONSTRAINT "Onboarding_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Onboarding" ADD CONSTRAINT "Onboarding_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Onboarding" ADD CONSTRAINT "Onboarding_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."OnboardingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingComment" ADD CONSTRAINT "OnboardingComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."OnboardingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingComment" ADD CONSTRAINT "OnboardingComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingHistory" ADD CONSTRAINT "OnboardingHistory_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "public"."Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingHistory" ADD CONSTRAINT "OnboardingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTask" ADD CONSTRAINT "OnboardingTask_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "public"."Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTask" ADD CONSTRAINT "OnboardingTask_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTask" ADD CONSTRAINT "OnboardingTask_templateTaskId_fkey" FOREIGN KEY ("templateTaskId") REFERENCES "public"."OnboardingTaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTaskTemplate" ADD CONSTRAINT "OnboardingTaskTemplate_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."OnboardingTemplateActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTemplate" ADD CONSTRAINT "OnboardingTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTemplateActivity" ADD CONSTRAINT "OnboardingTemplateActivity_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."OnboardingTemplateCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTemplateCategory" ADD CONSTRAINT "OnboardingTemplateCategory_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."OnboardingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTimeEntry" ADD CONSTRAINT "OnboardingTimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."OnboardingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OnboardingTimeEntry" ADD CONSTRAINT "OnboardingTimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParsedTransaction" ADD CONSTRAINT "ParsedTransaction_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParserRun" ADD CONSTRAINT "ParserRun_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "public"."ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ParserRun" ADD CONSTRAINT "ParserRun_parserDefinitionId_fkey" FOREIGN KEY ("parserDefinitionId") REFERENCES "public"."ParserDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupportTicket" ADD CONSTRAINT "SupportTicket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
