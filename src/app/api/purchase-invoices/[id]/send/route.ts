import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { financialEventIdFromCreation, protocolIdFrom } from "@/modules/conta-azul/financial-export";
import { INVOICE_SEND_PENDING, requiresInvoiceVerification } from "@/modules/purchase-invoices/send-state";
import { ContaAzulApiError, contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string }> };
type Rateio = { id_categoria: string; valor: number; rateio_centro_custo: Array<{ id_centro_custo: string; valor: number }> };

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}
function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function POST(_request: Request, context: RouteContext) {
  const member = await getPurchaseInvoiceMember();
  if (!member) return NextResponse.json({ error: "Sua sessão expirou." }, { status: 401 });
  const permission = await getPurchaseInvoicePermission(member);
  if (!permission.canExport) return NextResponse.json({ error: "Você não possui permissão para gerar despesas." }, { status: 403 });
  const { id } = await context.params;
  const invoice = await prisma.purchaseInvoice.findFirst({
    where: { id, organizationId: member.organizationId },
    include: {
      items: { orderBy: { lineNumber: "asc" } },
      installments: { orderBy: { installmentNumber: "asc" } },
      connection: true,
    },
  });
  if (!invoice) return NextResponse.json({ error: "Nota de compra não encontrada." }, { status: 404 });
  if (invoice.status === "SENT" || invoice.externalPayableProtocolId) {
    return NextResponse.json({ error: "Esta nota já possui uma despesa enviada e não será duplicada." }, { status: 409 });
  }
  if (requiresInvoiceVerification(invoice.lastError)) return NextResponse.json({ error: INVOICE_SEND_PENDING }, { status: 409 });
  if (!invoice.connection?.active) return NextResponse.json({ error: "Conecte este cliente à Conta Azul." }, { status: 400 });
  if (!invoice.supplierContaAzulId) return NextResponse.json({ error: "Selecione o fornecedor da Conta Azul." }, { status: 400 });
  if (!invoice.financialAccountId) return NextResponse.json({ error: "Selecione a conta financeira da despesa." }, { status: 400 });
  if (invoice.items.some((item) => !item.contaAzulCategoryId)) return NextResponse.json({ error: "Categorize todos os itens antes de enviar." }, { status: 400 });
  if (!invoice.installments.length) return NextResponse.json({ error: "Cadastre ao menos uma parcela para esta nota." }, { status: 400 });
  if (invoice.installments.some((installment) => installment.source === "MANUAL_REQUIRED")) {
    return NextResponse.json({ error: "Confirme os vencimentos das parcelas que não vieram informados na NF-e." }, { status: 400 });
  }

  const grouped = new Map<string, { value: number; centers: Map<string, number> }>();
  for (const item of invoice.items) {
    const categoryId = item.contaAzulCategoryId!;
    const current = grouped.get(categoryId) || { value: 0, centers: new Map<string, number>() };
    const amount = Number(item.allocationAmount);
    current.value = money(current.value + amount);
    if (item.contaAzulCostCenterId) {
      current.centers.set(item.contaAzulCostCenterId, money((current.centers.get(item.contaAzulCostCenterId) || 0) + amount));
    }
    grouped.set(categoryId, current);
  }
  const rateio: Rateio[] = Array.from(grouped.entries()).map(([categoryId, group]) => ({
    id_categoria: categoryId,
    valor: group.value,
    rateio_centro_custo: Array.from(group.centers.entries()).map(([costCenterId, value]) => ({ id_centro_custo: costCenterId, valor: value })),
  }));
  const totalInvoice = Number(invoice.totalInvoice);
  const allocated = money(rateio.reduce((sum, item) => sum + item.valor, 0));
  if (Math.abs(allocated - totalInvoice) > 0.01) {
    return NextResponse.json({ error: `O rateio soma R$ ${allocated.toFixed(2)}, mas a nota totaliza R$ ${totalInvoice.toFixed(2)}.` }, { status: 400 });
  }
  const installmentTotal = money(invoice.installments.reduce((sum, installment) => sum + Number(installment.amount), 0));
  if (Math.abs(installmentTotal - totalInvoice) > 0.01) {
    return NextResponse.json({ error: `As parcelas somam R$ ${installmentTotal.toFixed(2)}, mas a nota totaliza R$ ${totalInvoice.toFixed(2)}.` }, { status: 400 });
  }

  const payload = {
    referencia_externa: `FORTUNO-NFE-${invoice.id}`,
    data_competencia: dateOnly(invoice.competenceDate),
    valor: totalInvoice,
    observacao: `NF-e ${invoice.number}${invoice.series ? ` série ${invoice.series}` : ""}${invoice.accessKey ? ` | chave ${invoice.accessKey}` : ""} | criada pelo Fortuno Hub`,
    descricao: `Compra NF-e ${invoice.number} - ${invoice.supplierName}`,
    id_fornecedor: invoice.supplierContaAzulId,
    conta_financeira: invoice.financialAccountId,
    rateio,
    condicao_pagamento: {
      parcelas: invoice.installments.map((installment, index) => ({
        descricao: invoice.installments.length > 1
          ? `NF-e ${invoice.number} - parcela ${index + 1}/${invoice.installments.length} - ${invoice.supplierName}`
          : `NF-e ${invoice.number} - ${invoice.supplierName}`,
        data_vencimento: dateOnly(installment.dueDate),
        nota: `Parcela ${index + 1}/${invoice.installments.length} da despesa rateada e revisada no Fortuno Hub.`,
        conta_financeira: invoice.financialAccountId,
        detalhe_valor: {
          multa: 0,
          juros: 0,
          valor_bruto: Number(installment.amount),
          valor_liquido: Number(installment.amount),
          desconto: 0,
          taxa: 0,
        },
        metodo_pagamento: invoice.paymentMethod,
      })),
    },
  };

  // Reserve the send before the external write. A timeout must never enable an automatic retry.
  const claimed = await prisma.purchaseInvoice.updateMany({
    where: { id: invoice.id, organizationId: member.organizationId, status: invoice.status, externalPayableProtocolId: null, lastError: invoice.lastError ?? null },
    data: { status: "FAILED", lastError: INVOICE_SEND_PENDING },
  });
  if (!claimed.count) return NextResponse.json({ error: "Esta nota foi alterada ou já está em envio. Atualize a tela antes de continuar." }, { status: 409 });
  try {
    const result = await contaAzulRequest<unknown>(
      invoice.clientId,
      "/v1/financeiro/contas-a-pagar",
      { method: "POST", body: JSON.stringify(payload) },
    );
    const eventId = financialEventIdFromCreation(result);
    const protocolId = protocolIdFrom(result);
    const externalId = eventId || protocolId;
    if (!externalId) throw new Error(INVOICE_SEND_PENDING);
    // Legacy column name; now stores the synchronous event ID as well as older protocol IDs.
    await prisma.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { status: "SENT", externalPayableProtocolId: externalId, sentAt: new Date(), lastError: null },
    });
    return NextResponse.json({
      message: invoice.installments.length > 1
        ? `Despesa parcelada em ${invoice.installments.length} títulos enviada à Conta Azul com sucesso.`
        : "Despesa enviada à Conta Azul com sucesso.",
      protocolId,
      eventId,
      externalId,
    });
  } catch (error) {
    const rejected = error instanceof ContaAzulApiError && [400, 401, 403, 404, 422, 429].includes(error.status);
    const message = rejected ? error.message : INVOICE_SEND_PENDING;
    await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data: { status: "FAILED", lastError: message } });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
