CREATE TABLE IF NOT EXISTS "WhatsAppDepartment" (
 "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
 "name" TEXT NOT NULL, "nameKey" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT TRUE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppDepartment_organizationId_nameKey_key" ON "WhatsAppDepartment"("organizationId","nameKey");
CREATE INDEX IF NOT EXISTS "WhatsAppDepartment_organizationId_active_idx" ON "WhatsAppDepartment"("organizationId","active");
ALTER TABLE "ServiceTicket" ADD COLUMN IF NOT EXISTS "whatsappDepartmentId" TEXT REFERENCES "WhatsAppDepartment"("id") ON DELETE SET NULL;
ALTER TABLE "ServiceTicket" ADD COLUMN IF NOT EXISTS "whatsappDepartmentName" TEXT;
