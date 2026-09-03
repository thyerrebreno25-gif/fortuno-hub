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
type InstallmentInput = {
  externalNumber?: unknown;
  dueDate?: unknown;
  amount?: unknown;
  source?: unknown;
};

function textOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateAtNoon(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function PATCH(request: Request, context: RouteContext) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canEdit) return NextResponse.json({ error: "Você não possui permissão para revisar notas." }, { status: 403 });
  const { id } = await context.params;
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id, organizationId: member.organizationId },
    include: { items: true, installments: { orderBy: { installmentNumber: "asc" } } },
  });
  if (!invoice) return NextResponse.json({ error: "Nota de compra não encontrada." }, { status: 404 });
  if (invoice.status === "SENT") return NextResponse.json({ error: "A despesa desta nota já foi enviada." }, { status: 409 });

  const body = (await request.json()) as {
    supplierId?: unknown;
    supplierName?: unknown;
    financialAccountId?: unknown;
    financialAccountName?: unknown;
    paymentMethod?: unknown;
    items?: ItemInput[];
    installments?: InstallmentInput[];
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
  const installmentInputs = Array.isArray(body.installments) ? body.installments.slice(0, 120) : [];
  const installments = installmentInputs.flatMap((installment, index) => {
    const dueDate = dateAtNoon(installment.dueDate);
    const rawAmount = String(installment.amount || "").trim();
    const amount = typeof installment.amount === "number"
      ? installment.amount
      : Number(rawAmount.includes(",") ? rawAmount.replace(/\./g, "").replace(",", ".") : rawAmount);
    if (!dueDate || !Number.isFinite(amount) || amount <= 0) return [];
    const source = installment.source === "XML"
      ? "XML" as const
      : installment.source === "MANUAL"
        ? "MANUAL" as const
        : "MANUAL_REQUIRED" as const;
    return [{
      installmentNumber: index + 1,
      externalNumber: textOrNull(installment.externalNumber),
      dueDate,
      amount: money(amount),
      source,
    }];
  });
  if (!installments.length || installments.length !== installmentInputs.length) {
    return NextResponse.json({ error: "Revise as datas e os valores de todas as parcelas." }, { status: 400 });
  }
  const installmentTotal = money(installments.reduce((sum, installment) => sum + installment.amount, 0));
  const paymentsConfirmed = installments.every((installment) => installment.source !== "MANUAL_REQUIRED");
  const installmentsBalanced = Math.abs(installmentTotal - Number(invoice.totalInvoice)) <= 0.01;
  const allCategorized = updatedItems.every((item) => item.contaAzulCategoryId);
  const nextStatus = allCategorized && supplierId && financialAccountId && paymentsConfirmed && installmentsBalanced
    ? "READY_TO_SEND"
    : "PENDING_REVIEW";

  await prisma.$transaction(async (tx) => {
    await tx.purchaseInvoice.update({
      where: { id: invoice.id },
      data: {
        supplierContaAzulId: supplierId,
        supplierContaAzulName: supplierName,
        financialAccountId,
        financialAccountName,
        competenceDate: invoice.issueDate,
        dueDate: installments[0].dueDate,
        paymentMethod: typeof body.paymentMethod === "string" && body.paymentMethod ? body.paymentMethod : invoice.paymentMethod,
        status: nextStatus,
        lastError: null,
      },
    });

    await tx.purchaseInvoiceInstallment.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.purchaseInvoiceInstallment.createMany({
      data: installments.map((installment) => ({ invoiceId: invoice.id, ...installment })),
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

  const paymentMessage = !paymentsConfirmed
    ? " Confirme os vencimentos que não vieram na NF-e."
    : !installmentsBalanced
      ? ` As parcelas somam R$ ${installmentTotal.toFixed(2)}, mas a nota totaliza R$ ${Number(invoice.totalInvoice).toFixed(2)}.`
      : "";
  return NextResponse.json({
    message: nextStatus === "READY_TO_SEND" ? "Nota pronta para gerar a despesa." : `Revisão salva.${paymentMessage}`,
  });
}
