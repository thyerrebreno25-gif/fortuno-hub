import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { findAuthorizedClient, getPurchaseInvoiceMember } from "@/modules/purchase-invoices/server/auth";

export async function GET(request: Request) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (!permissions.IMPORTS.canExport && !permissions.PURCHASE_INVOICES.canExport) return NextResponse.json({ error: "Sem permissão para consultar os envios." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const clientId = params.get("clientId") || "";
  if (!await findAuthorizedClient(member, clientId)) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  const exportModule = params.get("module");
  if (exportModule && exportModule !== "CREDIT_CARD_INVOICE" && exportModule !== "ACQUIRER") return NextResponse.json({ error: "Módulo inválido." }, { status: 400 });
  const batches = await prisma.contaAzulFinancialExport.findMany({
    where: { organizationId: member.organizationId, clientId, ...(exportModule ? { module: exportModule } : {}), ...(params.get("exportId") ? { id: params.get("exportId")! } : {}) },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, module: true, sourceName: true, status: true, financialAccountId: true, financialAccountName: true, settleRequested: true, lastError: true, createdAt: true, updatedAt: true, completedAt: true,
      _count: { select: { lines: true } },
      lines: { orderBy: { createdAt: "asc" }, take: 100, select: { id: true, lineKey: true, description: true, direction: true, amount: true, competenceDate: true, dueDate: true, paymentDate: true, categoryName: true, status: true, lastError: true, externalProtocolId: true, externalEventId: true, externalInstallmentId: true, externalSettlementId: true, metadata: true } },
    },
  });
  return NextResponse.json({ batches }, { headers: { "Cache-Control": "no-store" } });
}
