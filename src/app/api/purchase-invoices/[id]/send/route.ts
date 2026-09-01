import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPurchaseInvoiceMember, getPurchaseInvoicePermission } from "@/modules/purchase-invoices/server/auth";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";

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
    include: { items: { orderBy: { lineNumber: "asc" } }, connection: true },
  });
  if (!invoice) return NextResponse.json({ error: "Nota fiscal não encontrada." }, { status: 404 });
  if (invoice.status === "SENT" || invoice.externalPayableProtocolId) {
    return NextResponse.json({ error: "Esta nota já possui uma despesa enviada e não será duplicada." }, { status: 409 });
  }
  if (!invoice.connection?.active) return NextResponse.json({ error: "Conecte este cliente à Conta Azul." }, { status: 400 });
  if (!invoice.supplierContaAzulId) return NextResponse.json({ error: "Selecione o fornecedor da Conta Azul." }, { status: 400 });
  if (!invoice.financialAccountId) return NextResponse.json({ error: "Selecione a conta financeira da despesa." }, { status: 400 });
  if (invoice.items.some((item) => !item.contaAzulCategoryId)) return NextResponse.json({ error: "Categorize todos os itens antes de enviar." }, { status: 400 });

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

  const payload = {
    data_competencia: dateOnly(invoice.competenceDate),
    valor: totalInvoice,
    observacao: `NF-e ${invoice.number}${invoice.series ? ` série ${invoice.series}` : ""}${invoice.accessKey ? ` | chave ${invoice.accessKey}` : ""} | criada pelo Fortuno Hub`,
    descricao: `Compra NF-e ${invoice.number} - ${invoice.supplierName}`,
    contato: invoice.supplierContaAzulId,
    conta_financeira: invoice.financialAccountId,
    rateio,
    condicao_pagamento: {
      parcelas: [{
        descricao: `NF-e ${invoice.number} - ${invoice.supplierName}`,
        data_vencimento: dateOnly(invoice.dueDate),
        nota: "Despesa rateada e revisada no Fortuno Hub.",
        conta_financeira: invoice.financialAccountId,
        detalhe_valor: { multa: 0, juros: 0, valor_bruto: totalInvoice, valor_liquido: totalInvoice, desconto: 0, taxa: 0 },
        metodo_pagamento: invoice.paymentMethod,
      }],
    },
  };

  try {
    const result = await contaAzulRequest<{ protocolo?: string; protocolId?: string; status?: string }>(
      invoice.clientId,
      "/v1/financeiro/eventos-financeiros/contas-a-pagar",
      { method: "POST", body: JSON.stringify(payload) },
    );
    const protocolId = result.protocolo || result.protocolId;
    if (!protocolId) throw new Error("A Conta Azul aceitou a requisição, mas não devolveu o protocolo da despesa.");
    await prisma.purchaseInvoice.update({
      where: { id: invoice.id },
      data: { status: "SENT", externalPayableProtocolId: protocolId, sentAt: new Date(), lastError: null },
    });
    return NextResponse.json({ message: "Despesa enviada à Conta Azul com sucesso.", protocolId, status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível gerar a despesa.";
    await prisma.purchaseInvoice.update({ where: { id: invoice.id }, data: { status: "FAILED", lastError: message } });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
