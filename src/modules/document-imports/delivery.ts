import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contaAzulRequest, ContaAzulApiError } from "@/modules/purchase-invoices/server/conta-azul";
import { apiItems } from "@/modules/conta-azul/financial-export";
import { investmentSchema, normalize, reviewIssues, type InvestmentReview } from "./model";
import { importOptions } from "./server";
import { closingAccountBalance } from "./account-balance";
import { compareBalances, type AccountClosingBalance } from "./balance-model";

type Delivery = Awaited<ReturnType<typeof prisma.documentImportDelivery.findMany>>[number];
type Row = InvestmentReview["rows"][number];
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const uuid = (value: unknown): string | null => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value : null;
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null;
export function incomeBusinessKey(organizationId: string, clientId: string, review: InvestmentReview, row: Row) {
  return createHash("sha256").update(JSON.stringify([organizationId, clientId, review.bankAccount, review.periodStart.slice(0, 7), normalize(row.description)])).digest("hex");
}
export function salePayload(review: InvestmentReview, row: Row, marker: string, number: number) {
  return { id_cliente: review.customerId, numero: number, situacao: "APROVADO", data_venda: row.date, id_categoria: row.categoryId,
    observacoes: `${marker} | Rendimento de aplicação: ${row.description} | ${review.periodStart} a ${review.periodEnd}`,
    itens: [{ id: review.serviceId, descricao: `Rendimento - ${row.description}`, quantidade: 1, valor: row.amountCents / 100 }],
    condicao_pagamento: { tipo_pagamento: "OUTRO", id_conta_financeira: row.accountId, opcao_condicao_pagamento: "À vista", parcelas: [{ data_vencimento: row.date, valor: row.amountCents / 100, descricao: marker }] },
  };
}
const definiteRejection = (error: unknown) => error instanceof ContaAzulApiError && [400, 401, 403, 404, 405, 422].includes(error.status);
export const deliverySummary = { id: true, rowKey: true, status: true, saleNumber: true, saleId: true, settlementId: true, lastError: true } as const;

async function readSale(delivery: Delivery, review: InvestmentReview, row: Row) {
  let saleId = delivery.saleId;
  if (!saleId && delivery.saleNumber !== null) {
    const query = new URLSearchParams({ pagina: "1", tamanho_pagina: "100", numeros: String(delivery.saleNumber) });
    const candidates = apiItems(await contaAzulRequest(delivery.clientId, `/v1/venda/busca?${query}`));
    for (const candidate of candidates) {
      if (!uuid(candidate.id)) continue;
      const response = object(await contaAzulRequest(delivery.clientId, `/v1/venda/${candidate.id}`));
      const sale = object(response.venda);
      if (typeof sale.observacoes === "string" && sale.observacoes.includes(delivery.marker)) {
        if (saleId) throw new Error("Mais de uma venda encontrada com a referência do envio. Confira no CA.");
        saleId = String(candidate.id);
      }
    }
  }
  if (!saleId) return null;
  const response = object(await contaAzulRequest(delivery.clientId, `/v1/venda/${saleId}`));
  const sale = object(response.venda);
  if (sale.id_cliente !== review.customerId || sale.numero !== delivery.saleNumber || sale.id_categoria !== row.categoryId || String(sale.data_compromisso || "").slice(0, 10) !== row.date || !String(sale.observacoes || "").includes(delivery.marker)) throw new Error("A venda no CA não corresponde à revisão aprovada. Confira antes de retomar.");
  const items = apiItems(await contaAzulRequest(delivery.clientId, `/v1/venda/${saleId}/itens`));
  if (items.length !== 1 || items[0].id_item !== review.serviceId || items[0].quantidade !== 1 || amount(items[0].valor) !== row.amountCents) throw new Error("O serviço ou valor da venda foi alterado no CA. Confira antes de registrar a baixa.");
  const eventId = uuid(object(response.evento_financeiro).id);
  return { saleId, eventId };
}
async function installmentFor(delivery: Delivery, eventId: string, row: Row) {
  const body = await contaAzulRequest<unknown>(delivery.clientId, `/v1/financeiro/eventos-financeiros/${eventId}/parcelas`);
  const installments = apiItems(body);
  if (installments.length !== 1) throw new Error("A venda ainda não tem uma única parcela financeira confirmada. Verifique novamente.");
  const item = installments[0];
  const id = uuid(item.id);
  const value = amount(item.valor_liquido ?? object(item.valor_composicao).valor_liquido ?? object(item.composicao_valor).valor_liquido);
  if (!id || value !== row.amountCents || String(item.data_vencimento).slice(0, 10) !== row.date) throw new Error("Valor ou vencimento da parcela no CA diverge da venda aprovada.");
  return id;
}
async function settlementFor(delivery: Delivery, installmentId: string, row: Row) {
  const body = await contaAzulRequest<unknown>(delivery.clientId, `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`);
  if (!Array.isArray(body)) throw new Error("Não foi possível confirmar as baixas da parcela.");
  let found: string | null = null;
  for (const value of body) {
    const item = object(value);
    const financialAccount = typeof item.conta_financeira === "string" ? item.conta_financeira : object(item.conta_financeira).id;
    if (String(item.observacao || "").includes(delivery.marker) && financialAccount === row.accountId && amount(object(item.valor_composicao).valor_liquido) === row.amountCents && String(item.data_pagamento).slice(0, 10) === row.date && uuid(item.id)) {
      if (found) throw new Error("Mais de uma baixa encontrada para este rendimento. Confira no CA.");
      found = String(item.id);
    } else { throw new Error("A parcela possui uma baixa diferente da aprovada. Confira no CA antes de retomar."); }
  }
  return found;
}

export async function sendInvestmentReview(input: { organizationId: string; userId: string; reviewId: string; version: number }) {
  const draft = await prisma.documentImportReview.findFirst({ where: { id: input.reviewId, organizationId: input.organizationId, kind: "INVESTMENT" } });
  if (!draft) throw new Error("Revisão não encontrada.");
  const token = randomUUID();
  await prisma.documentImportDispatchLease.upsert({ where: { clientId: draft.clientId }, create: { clientId: draft.clientId, organizationId: input.organizationId, token: "", expiresAt: new Date(0) }, update: {} });
  const locked = await prisma.documentImportDispatchLease.updateMany({ where: { clientId: draft.clientId, organizationId: input.organizationId, expiresAt: { lte: new Date() } }, data: { token, expiresAt: new Date(Date.now() + 10 * 60000) } });
  if (!locked.count) throw new Error("Já há um envio desta empresa em andamento. Aguarde antes de retomar.");
  const deadline = Date.now() + 260000;
  async function assertLease() {
    if (Date.now() > deadline || !await prisma.documentImportDispatchLease.findFirst({ where: { clientId: draft!.clientId, token, expiresAt: { gt: new Date() } } })) throw new Error("O envio foi pausado. Verifique o andamento antes de retomar.");
  }
  try {
    const current = await prisma.documentImportReview.findFirst({ where: { id: draft.id, organizationId: input.organizationId, version: input.version } });
    if (!current) throw new Error("A revisão foi alterada. Recarregue antes de enviar.");
    const review = investmentSchema.parse(current.data);
    const errors = reviewIssues(review, true);
    if (review.rows.length > 20 || !review.bankAccount || review.periodStart.slice(-2) !== "01" || review.periodStart.slice(0, 7) !== review.periodEnd.slice(0, 7)) errors.push("O envio exige um extrato mensal com a conta bancária identificada e até 20 tipos de aplicação.");
    if (errors.length) throw new Error(errors.join(" "));
    let deliveries = await prisma.documentImportDelivery.findMany({ where: { reviewId: draft.id, organizationId: input.organizationId }, orderBy: { createdAt: "asc" } });
    if (deliveries.length === review.rows.length && deliveries.every((item) => item.status === "SENT")) {
      await prisma.documentImportReview.update({ where: { id: draft.id }, data: { status: "SENT" } });
      return { deliveries, completed: true };
    }
    const options = await importOptions(draft.clientId, "INVESTMENT");
    if (!options.customers.some((item) => item.value === review.customerId) || !options.services.some((item) => item.value === review.serviceId)) throw new Error("Selecione cliente e serviço ativos da empresa no CA.");
    for (const row of review.rows) if (!options.categories.some((item) => item.value === row.categoryId) || !options.financialAccounts.some((item) => item.value === row.accountId)) throw new Error("Categoria ou conta financeira não pertence à empresa selecionada.");

    // Recover only by GET before computing remaining income. No uncertain POST is repeated.
    for (const delivery of deliveries.filter((item) => item.status !== "SENT" && item.status !== "PENDING" && item.status !== "FAILED")) {
      await assertLease();
      const row = review.rows.find((item) => item.key === delivery.rowKey);
      if (!row) throw new Error("A revisão enviada não pode ser alterada.");
      const sale = await readSale(delivery, review, row);
      if (!sale) throw new Error("O resultado da criação da venda está incerto. Não será criada outra venda; confira no CA.");
      await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { saleId: sale.saleId, status: delivery.status === "SETTLING" || delivery.status === "UNCERTAIN_SETTLEMENT" ? "UNCERTAIN_SETTLEMENT" : "SALE_CREATED" } });
      if (!sale.eventId) throw new Error("A venda existe, mas o CA ainda não retornou o evento financeiro. Verifique novamente.");
      const installmentId = await installmentFor(delivery, sale.eventId, row);
      const settlementId = await settlementFor(delivery, installmentId, row);
      if (settlementId) await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, settlementId, status: "SENT", lastError: null } });
      else if (["SETTLING", "UNCERTAIN_SETTLEMENT"].includes(delivery.status)) throw new Error("O resultado da baixa está incerto. Nenhuma nova baixa será feita; confira no CA.");
      else await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, status: "SALE_CREATED" } });
    }
    deliveries = await prisma.documentImportDelivery.findMany({ where: { reviewId: draft.id, organizationId: input.organizationId } });
    const remaining = { ...review, rows: review.rows.map((row) => ({ ...row, amountCents: deliveries.some((item) => item.rowKey === row.key && item.status === "SENT") ? 0 : row.amountCents })) };
    const balances: AccountClosingBalance[] = [];
    for (const accountId of new Set(review.rows.map((row) => row.accountId))) balances.push(await closingAccountBalance(draft.clientId, accountId, review.periodEnd, new Date(), deadline - 30000));
    if (compareBalances(remaining, balances).some((item) => item.status !== "OK")) throw new Error("O saldo do CA mais os rendimentos ainda pendentes não confere com o extrato. Atualize a conferência antes de enviar.");
    await assertLease();
    // Freeze review and reserve semantic monthly keys atomically across repeated PDFs.
    await prisma.$transaction(async (tx) => {
      const frozen = await tx.documentImportReview.updateMany({ where: { id: draft.id, organizationId: input.organizationId, version: input.version }, data: { status: "SENDING", version: { increment: 1 } } });
      if (!frozen.count) throw new Error("A revisão mudou durante a conferência. Recarregue.");
      for (const row of review.rows) {
        const businessKey = incomeBusinessKey(input.organizationId, draft.clientId, review, row);
        const existing = await tx.documentImportDelivery.findUnique({ where: { businessKey } });
        if (existing && existing.reviewId !== draft.id) throw new Error("Já existe envio desta aplicação neste mês em outro arquivo. Abra a revisão original para evitar duplicidade.");
        if (!existing) await tx.documentImportDelivery.create({ data: { organizationId: input.organizationId, clientId: draft.clientId, reviewId: draft.id, rowKey: row.key, businessKey, marker: `FORTUNO-REND-${businessKey.slice(0, 24)}`, payload: { review, rowKey: row.key } as unknown as Prisma.InputJsonValue } });
      }
      await tx.auditLog.create({ data: { userId: input.userId, action: "INVESTMENT_SEND_CONFIRMED", entity: "DocumentImportReview", entityId: draft.id, afterData: { clientId: draft.clientId, version: input.version, totalCents: review.rows.reduce((sum, row) => sum + row.amountCents, 0) } } });
    });
    deliveries = await prisma.documentImportDelivery.findMany({ where: { reviewId: draft.id, organizationId: input.organizationId }, orderBy: { createdAt: "asc" } });
    for (let delivery of deliveries) {
      if (delivery.status === "SENT") continue;
      const row = review.rows.find((item) => item.key === delivery.rowKey)!;
      await assertLease();
      try {
        if (!delivery.saleId) {
          if (!["PENDING", "FAILED"].includes(delivery.status)) throw new Error("Criação com resultado incerto. Verifique antes de retomar.");
          const number = await contaAzulRequest<unknown>(draft.clientId, "/v1/venda/proximo-numero");
          if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > 2147483647) throw new Error("Não foi possível obter o próximo número da venda.");
          delivery = await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { saleNumber: number, status: "CREATING", lastError: null } });
          await assertLease();
          let response;
          try { response = object(await contaAzulRequest(draft.clientId, "/v1/venda", { method: "POST", body: JSON.stringify(salePayload(review, row, delivery.marker, number)) })); }
          catch (error) { await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: definiteRejection(error) ? "FAILED" : "UNCERTAIN_SALE", lastError: "A criação da venda não foi confirmada. Verifique o andamento antes de retomar." } }); throw new Error("A criação da venda não foi confirmada."); }
          const saleId = uuid(response.id);
          if (!saleId) throw new Error("O CA não retornou o identificador da venda. Verifique o andamento antes de retomar.");
          delivery = await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { saleId, status: "SALE_CREATED" } });
        }
        const sale = await readSale(delivery, review, row);
        if (!sale?.eventId) throw new Error("Venda criada; aguardando o evento financeiro do CA. Verifique novamente.");
        const installmentId = await installmentFor(delivery, sale.eventId, row);
        const existingSettlement = await settlementFor(delivery, installmentId, row);
        if (existingSettlement) { await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, settlementId: existingSettlement, status: "SENT", lastError: null } }); continue; }
        await assertLease();
        await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, status: "SETTLING" } });
        let response;
        try { response = object(await contaAzulRequest(draft.clientId, `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`, { method: "POST", body: JSON.stringify({ data_pagamento: row.date, conta_financeira: row.accountId, composicao_valor: { valor_bruto: row.amountCents / 100, juros: 0, multa: 0, desconto: 0, taxa: 0 }, metodo_pagamento: "OUTRO", observacao: delivery.marker }) })); }
        catch (error) { await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: definiteRejection(error) ? "SALE_CREATED" : "UNCERTAIN_SETTLEMENT", lastError: "Venda criada, mas a baixa não foi confirmada. Verifique antes de retomar." } }); throw new Error("A baixa não foi confirmada."); }
        const settlementId = uuid(response.id);
        if (!settlementId) throw new Error("O CA não confirmou o identificador da baixa. Verifique antes de retomar.");
        await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, settlementId, status: "SENT", lastError: null } });
      } catch (error) {
        const message = error instanceof Error && !(error instanceof ContaAzulApiError) ? error.message : "Não foi possível confirmar esta etapa no CA. Verifique o andamento antes de retomar.";
        await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { lastError: message.slice(0, 300) } });
        break;
      }
    }
    const final = await prisma.documentImportDelivery.findMany({ where: { reviewId: draft.id, organizationId: input.organizationId }, orderBy: { createdAt: "asc" } });
    const completed = final.every((item) => item.status === "SENT");
    await prisma.documentImportReview.update({ where: { id: draft.id }, data: { status: completed ? "SENT" : "PARTIAL" } });
    return { deliveries: final, completed };
  } finally {
    await prisma.documentImportDispatchLease.updateMany({ where: { clientId: draft.clientId, token }, data: { expiresAt: new Date(0) } });
  }
}
