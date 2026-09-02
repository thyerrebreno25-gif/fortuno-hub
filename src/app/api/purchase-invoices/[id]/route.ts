import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";

type RouteContext = { params: Promise<{ id: string }> };
type ItemInput = {
  id?: unknown;
  categoryId?: unknown;
  categoryName?: unknown;
  costCenterId?: unknown;
  costCenterName?: unknown;
};

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
export async function PATCH(request: Request, context: RouteContext) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canEdit) return NextResponse.json({ error: "Você não possui permissão para revisar notas." }, { status: 403 });
  const { id } = await context.params;
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id, organizationId: member.organizationId },
    include: { items: true },
  });
  if (!invoice) return NextResponse.json({ error: "Nota de compra não encontrada." }, { status: 404 });
  if (invoice.status === "SENT") return NextResponse.json({ error: "A despesa desta nota já foi enviada." }, { status: 409 });

  const body = (await request.json()) as {
    supplierId?: unknown;
    supplierName?: unknown;
    financialAccountId?: unknown;
    financialAccountName?: unknown;
    competenceDate?: unknown;
    dueDate?: unknown;
    paymentMethod?: unknown;
    items?: ItemInput[];
  };
  const itemInputs = Array.isArray(body.items) ? body.items : [];
  const byId = new Map(itemInputs.map((item) => [String(item.id || ""), item]));
  const updatedItems = invoice.items.map((item) => {
    const input = byId.get(item.id);
    if (!input) return item;
    return {
      ...item,
      contaAzulCategoryId: textOrNull(input.categoryId),
      contaAzulCategoryName: textOrNull(input.categoryName),
      contaAzulCostCenterId: textOrNull(input.costCenterId),
      contaAzulCostCenterName: textOrNull(input.costCenterName),
    };
  });
  const supplierId = textOrNull(body.supplierId);
  const supplierName = textOrNull(body.supplierName);
  const financialAccountId = textOrNull(body.financialAccountId);
  const financialAccountName = textOrNull(body.financialAccountName);
  const allCategorized = updatedItems.every((item) => item.contaAzulCategoryId);
  const nextStatus = allCategorized && supplierId && financialAccountId ? "READY_TO_SEND" : "PENDING_REVIEW";

  await prisma.$transaction(async (tx) => {
    await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: {
        supplierContaAzulId: supplierId,
        supplierContaAzulName: supplierName,
        financialAccountId,
        financialAccountName,
        competenceDate: typeof body.competenceDate === "string" ? new Date(`${body.competenceDate}T12:00:00.000Z`) : invoice.competenceDate,
        dueDate: typeof body.dueDate === "string" ? new Date(`${body.dueDate}T12:00:00.000Z`) : invoice.dueDate,
        paymentMethod: typeof body.paymentMethod === "string" && body.paymentMethod ? body.paymentMethod : invoice.paymentMethod,
        status: nextStatus,
        lastError: null,
      },
    });

    for (const item of updatedItems) {
      if (!byId.has(item.id)) continue;
      await tx.purchaseInvoiceItem.update({
        where: { id: item.id },
        data: {
          contaAzulCategoryId: item.contaAzulCategoryId,
          contaAzulCategoryName: item.contaAzulCategoryName,
          contaAzulCostCenterId: item.contaAzulCostCenterId,
          contaAzulCostCenterName: item.contaAzulCostCenterName,
          learned: false,
        },
      });
      if (item.contaAzulCategoryId && item.contaAzulCategoryName) {
        const ruleKey = {
          clientId: invoice.clientId,
          supplierDocument: invoice.supplierDocument || "",
          productCode: item.productCode || "",
          normalizedDescription: item.normalizedDescription,
        };
        await tx.purchaseInvoiceRule.upsert({
          where: { clientId_supplierDocument_productCode_normalizedDescription: ruleKey },
          create: {
            ...ruleKey,
            contaAzulCategoryId: item.contaAzulCategoryId,
            contaAzulCategoryName: item.contaAzulCategoryName,
            contaAzulCostCenterId: item.contaAzulCostCenterId,
            contaAzulCostCenterName: item.contaAzulCostCenterName,
          },
          update: {
            contaAzulCategoryId: item.contaAzulCategoryId,
            contaAzulCategoryName: item.contaAzulCategoryName,
            contaAzulCostCenterId: item.contaAzulCostCenterId,
            contaAzulCostCenterName: item.contaAzulCostCenterName,
            usageCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        });
      }
    }
  });

  return NextResponse.json({ message: nextStatus === "READY_TO_SEND" ? "Nota pronta para gerar a despesa." : "Revisão salva." });
}
