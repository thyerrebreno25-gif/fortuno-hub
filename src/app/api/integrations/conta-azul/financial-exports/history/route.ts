import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { findAuthorizedClient, getPurchaseInvoiceMember } from "@/modules/purchase-invoices/server/auth";

import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import { apiItems, normalizeContaAzulLabel } from "@/modules/conta-azul/financial-export";
import { confirmFinancialInstallment, confirmFinancialSettlement } from "@/modules/conta-azul/financial-confirmation";
import { exportLineDestinationClient, exportLineFinancialAccount } from "@/modules/conta-azul/financial-account-allocation";
export const maxDuration = 120;

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
  const verify = params.get("verify") === "1";
  if (verify && !params.get("exportId")) return NextResponse.json({ error: "Selecione um envio para conferir." }, { status: 400 });
  const page = Math.max(0, Math.min(250, Number.parseInt(params.get("page") || "0", 10) || 0));
  const batches = await prisma.contaAzulFinancialExport.findMany({
    where: { organizationId: member.organizationId, clientId, ...(exportModule ? { module: exportModule as "CREDIT_CARD_INVOICE" | "ACQUIRER" } : {}), ...(params.get("exportId") ? { id: params.get("exportId")! } : {}) },
    orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, module: true, sourceName: true, status: true, financialAccountId: true, financialAccountName: true, settleRequested: true, lastError: true, createdAt: true, updatedAt: true, completedAt: true,
      _count: { select: { lines: true } },
      lines: { orderBy: { createdAt: "asc" }, take: verify ? 20 : 100, skip: verify ? page * 20 : 0, select: { id: true, lineKey: true, description: true, direction: true, amount: true, competenceDate: true, dueDate: true, paymentDate: true, categoryName: true, contaAzulCategoryId: true, status: true, lastError: true, externalProtocolId: true, externalEventId: true, externalInstallmentId: true, externalSettlementId: true, metadata: true } },
    },
  });
  const checks: Array<{ lineId: string; status: string; message: string }> = [];
  if (verify) for (const batch of batches) for (const line of batch.lines) {
    const destinationId = exportLineDestinationClient(line.metadata, clientId);
    if (!await findAuthorizedClient(member, destinationId)) { checks.push({ lineId: line.id, status: "UNAVAILABLE", message: "Sem acesso ao cadastro de destino." }); continue; }
    const accountId = exportLineFinancialAccount(line.metadata, batch.financialAccountId);
    try {
      let installmentId = line.externalInstallmentId;
      if (!installmentId && line.externalEventId) installmentId = String(apiItems(await contaAzulRequest(destinationId, "/v1/financeiro/eventos-financeiros/" + line.externalEventId + "/parcelas"))[0]?.id || "") || null;
      if (!installmentId) {
        const query = new URLSearchParams({ pagina: "1", tamanho_pagina: "100", data_vencimento_de: line.dueDate.toISOString().slice(0, 10), data_vencimento_ate: line.dueDate.toISOString().slice(0, 10), valor_de: Number(line.amount).toFixed(2), valor_ate: Number(line.amount).toFixed(2), descricao: line.description, ids_contas_financeiras: accountId });
        const kind = line.direction === "RECEIVABLE" ? "contas-a-receber" : "contas-a-pagar";
        const body = await contaAzulRequest(destinationId, "/v1/financeiro/eventos-financeiros/" + kind + "/buscar?" + query);
        const matches = apiItems(body).filter((item) => normalizeContaAzulLabel(String(item.descricao || "")) === normalizeContaAzulLabel(line.description));
        checks.push({ lineId: line.id, status: "UNCONFIRMED", message: matches.length ? "Há possível correspondência no CA, mas falta confirmar o vínculo com este envio. Nenhum reenvio foi feito." : "Nenhuma parcela correspondente retornou na consulta ao CA. O registro do Hub não comprova a importação." });
        continue;
      }
      const detail = await contaAzulRequest(destinationId, "/v1/financeiro/eventos-financeiros/parcelas/" + installmentId);
      const confirmed = confirmFinancialInstallment(detail, { direction: line.direction, description: line.description, amount: Number(line.amount), competenceDate: line.competenceDate.toISOString().slice(0, 10), dueDate: line.dueDate.toISOString().slice(0, 10), financialAccountId: accountId, categoryId: line.contaAzulCategoryId });
      if (line.externalEventId && confirmed.eventId !== line.externalEventId) throw new Error("A parcela encontrada pertence a outro evento financeiro.");
      const settlement = batch.settleRequested ? confirmFinancialSettlement(await contaAzulRequest(destinationId, "/v1/financeiro/eventos-financeiros/parcelas/" + installmentId + "/baixa"), { amount: Number(line.amount), accountId, date: (line.paymentDate || line.dueDate).toISOString().slice(0, 10) }) : null;
      checks.push({ lineId: line.id, status: batch.settleRequested && !settlement ? "PAYMENT_PENDING" : "CONFIRMED", message: batch.settleRequested ? settlement ? "Lançamento e baixa confirmados no CA." : "Lançamento localizado no CA; baixa ainda pendente." : "Parcela confirmada no CA." });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : null;
      checks.push({ lineId: line.id, status: status === 404 ? "NOT_FOUND" : "UNAVAILABLE", message: status === 404 ? "O identificador salvo no Hub não foi encontrado no CA. Nenhum reenvio foi feito." : error instanceof Error ? error.message : "Não foi possível conferir este lançamento no CA." });
    }
  }
  return NextResponse.json({ batches, checks, page, readOnly: true }, { headers: { "Cache-Control": "no-store" } });
}
