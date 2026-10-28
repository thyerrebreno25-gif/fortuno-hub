import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contaAzulRequest, ContaAzulApiError } from "@/modules/purchase-invoices/server/conta-azul";
import { buildDirectFinancialEventPayload, automaticFinancialContactName, contaAzulOptions, normalizeContaAzulLabel, apiItems } from "@/modules/conta-azul/financial-export";
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
export function incomePayload(review: InvestmentReview, row: Row, marker: string, contactId: string) {
  return buildDirectFinancialEventPayload({ direction: "RECEIVABLE", competenceDate: row.date, dueDate: row.date,
    description: marker + " | Rendimento - " + row.description,
    observation: marker + " | Rendimento de aplicação | " + review.periodStart + " a " + review.periodEnd,
    amount: row.amountCents / 100, contactId, financialAccountId: row.accountId, categoryId: row.categoryId, externalReference: marker });
}
async function incomeContact(clientId: string) {
  const name = automaticFinancialContactName(["Cliente"]);
  const query = new URLSearchParams({ pagina: "1", tamanho_pagina: "100", busca: name, tipo_perfil: "Cliente", com_endereco: "false" });
  const body = await contaAzulRequest<unknown>(clientId, "/v1/pessoas?" + query);
  if (!Array.isArray(body) && !Array.isArray(object(body).itens)) throw new Error("Não foi possível confirmar o cadastro financeiro no CA.");
  const matches = contaAzulOptions(body).filter((item) => normalizeContaAzulLabel(item.label) === normalizeContaAzulLabel(name));
  if (matches.length > 1) throw new Error("Há contatos financeiros automáticos duplicados no CA. Confira o cadastro antes de enviar.");
  if (matches.length) {
    const personBody = await contaAzulRequest(clientId, "/v1/pessoas/" + matches[0].value);
    const person = apiItems(personBody)[0] || object(personBody);
    const profiles = Array.isArray(person.perfis) ? person.perfis : [];
    if (person.ativo === false || !profiles.some((profile: unknown) => normalizeContaAzulLabel(typeof profile === "string" ? profile : String(object(profile).tipo_perfil || "")) === "cliente")) throw new Error("O contato financeiro automático está inativo ou sem perfil de receita no CA.");
    return matches[0].value;
  }
  if (apiItems(body).length >= 100 || typeof object(body).itens_totais === "number" && Number(object(body).itens_totais) > 100) throw new Error("Não foi possível consultar todos os contatos financeiros automáticos.");
  const created = await contaAzulRequest(clientId, "/v1/pessoas", { method: "POST", body: JSON.stringify({ ativo: true, nome: name, observacao: "Contato técnico para receitas financeiras automáticas do Fortuno Hub.", perfis: [{ tipo_perfil: "Cliente" }], tipo_pessoa: "Jurídica" }) });
  const id = uuid(contaAzulOptions(created)[0]?.value);
  if (!id) throw new Error("O CA não confirmou o contato financeiro automático. Confira antes de retomar.");
  return id;
}
const definiteRejection = (error: unknown) => error instanceof ContaAzulApiError && [400, 401, 403, 404, 405, 422].includes(error.status);
export const deliverySummary = { id: true, rowKey: true, status: true, saleNumber: true, saleId: true, eventId: true, settlementId: true, lastError: true } as const;

async function readIncome(delivery: Delivery, row: Row) {
  if (delivery.eventId) return { eventId: delivery.eventId };
  const candidates: Record<string, unknown>[] = [];
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ pagina: String(page), tamanho_pagina: "100", descricao: delivery.marker, data_vencimento_de: row.date, data_vencimento_ate: row.date });
    const body = await contaAzulRequest(delivery.clientId, "/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?" + query);
    const rows = apiItems(body);
    candidates.push(...rows);
    if (rows.length < 100) break;
    if (page === 10) throw new Error("Consulta da receita incompleta. Confira no CA.");
  }
  let eventId: string | null = null;
  for (const candidate of candidates) {
    if (!uuid(candidate.id) || !String(candidate.descricao || "").startsWith(delivery.marker + " | ")) continue;
    const item = object(await contaAzulRequest(delivery.clientId, "/v1/financeiro/eventos-financeiros/parcelas/" + candidate.id));
    if (!String(item.nota || "").startsWith(delivery.marker + " | ")) continue;
    const id = uuid(object(item.evento).id);
    if (!id || eventId) throw new Error("Referência da receita duplicada ou inválida no CA. Confira antes de retomar.");
    eventId = id;
  }
  return eventId ? { eventId } : null;
}
async function installmentFor(delivery: Delivery, eventId: string, row: Row) {
  const body = await contaAzulRequest<unknown>(delivery.clientId, `/v1/financeiro/eventos-financeiros/${eventId}/parcelas`);
  const installments = apiItems(body);
  if (installments.length !== 1) throw new Error("A receita ainda não tem uma única parcela financeira confirmada. Verifique novamente.");
  const item = installments[0];
  const allocation = apiItems(object(item.evento).rateio);
  if (allocation.length !== 1 || allocation[0].id_categoria !== row.categoryId || amount(allocation[0].valor ?? allocation[0].valor_bruto) !== row.amountCents) throw new Error("A categoria ou o valor da receita foi alterado no CA. Confira antes de registrar a baixa.");
  const id = uuid(item.id);
  const value = amount(item.valor_liquido ?? object(item.valor_composicao).valor_liquido ?? object(item.composicao_valor).valor_liquido);
  if (!id || value !== row.amountCents || String(item.data_vencimento).slice(0, 10) !== row.date || !String(item.nota || "").startsWith(delivery.marker + " | ") || object(item.evento).tipo !== "RECEITA" || object(item.evento).id !== eventId || (item.id_conta_financeira || object(item.conta_financeira).id) !== row.accountId) throw new Error("Valor ou vencimento da parcela no CA diverge da receita aprovada.");
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
    if (deliveries.some((item) => item.saleId || item.saleNumber !== null || object(item.payload).flow !== "FINANCIAL")) throw new Error("Este arquivo possui um envio comercial anterior. Confira os lançamentos existentes antes de continuar pela receita financeira.");
    const options = await importOptions(draft.clientId, "INVESTMENT");
    for (const row of review.rows) if (!options.categories.some((item) => item.value === row.categoryId) || !options.financialAccounts.some((item) => item.value === row.accountId)) throw new Error("Categoria ou conta financeira não pertence à empresa selecionada.");

    // Recover only by GET before computing remaining income. No uncertain POST is repeated.
    for (const delivery of deliveries.filter((item) => item.status !== "SENT" && item.status !== "PENDING" && item.status !== "FAILED")) {
      await assertLease();
      const row = review.rows.find((item) => item.key === delivery.rowKey);
      if (!row) throw new Error("A revisão enviada não pode ser alterada.");
      const income = await readIncome(delivery, row);
      if (!income) throw new Error("O resultado da criação da receita está incerto. Não será criada outra receita; confira no CA.");
      await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { eventId: income.eventId, status: delivery.status === "SETTLING" || delivery.status === "UNCERTAIN_SETTLEMENT" ? "UNCERTAIN_SETTLEMENT" : "RECEIVABLE_CREATED" } });
      if (!income.eventId) throw new Error("A receita existe, mas o CA ainda não retornou o evento financeiro. Verifique novamente.");
      const installmentId = await installmentFor(delivery, income.eventId, row);
      const settlementId = await settlementFor(delivery, installmentId, row);
      if (settlementId) await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, settlementId, status: "SENT", lastError: null } });
      else if (["SETTLING", "UNCERTAIN_SETTLEMENT"].includes(delivery.status)) throw new Error("O resultado da baixa está incerto. Nenhuma nova baixa será feita; confira no CA.");
      else await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, status: "RECEIVABLE_CREATED" } });
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
        if (!existing) await tx.documentImportDelivery.create({ data: { organizationId: input.organizationId, clientId: draft.clientId, reviewId: draft.id, rowKey: row.key, businessKey, marker: `FORTUNO-REND-${businessKey.slice(0, 24)}`, payload: { flow: "FINANCIAL", review, rowKey: row.key } as unknown as Prisma.InputJsonValue } });
      }
      await tx.auditLog.create({ data: { userId: input.userId, action: "INVESTMENT_SEND_CONFIRMED", entity: "DocumentImportReview", entityId: draft.id, afterData: { clientId: draft.clientId, version: input.version, totalCents: review.rows.reduce((sum, row) => sum + row.amountCents, 0) } } });
    });
    deliveries = await prisma.documentImportDelivery.findMany({ where: { reviewId: draft.id, organizationId: input.organizationId }, orderBy: { createdAt: "asc" } });
    let contactId: string | null = null;
    for (let delivery of deliveries) {
      if (delivery.status === "SENT") continue;
      const row = review.rows.find((item) => item.key === delivery.rowKey)!;
      await assertLease();
      try {
        if (!delivery.eventId) {
          if (!["PENDING", "FAILED"].includes(delivery.status)) throw new Error("Criação com resultado incerto. Verifique antes de retomar.");
          contactId ||= await incomeContact(draft.clientId);
          delivery = await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: "CREATING", lastError: null } });
          await assertLease();
          let response;
          try { response = object(await contaAzulRequest(draft.clientId, "/v1/financeiro/contas-a-receber", { method: "POST", body: JSON.stringify(incomePayload(review, row, delivery.marker, contactId)) })); }
          catch (error) { await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: definiteRejection(error) ? "FAILED" : "UNCERTAIN_RECEIVABLE", lastError: "A criação da receita não foi confirmada. Verifique o andamento antes de retomar." } }); throw new Error("A criação da receita não foi confirmada."); }
          const eventId = uuid(response.id);
          if (!eventId) throw new Error("O CA não retornou o identificador da receita. Verifique o andamento antes de retomar.");
          delivery = await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { eventId, status: "RECEIVABLE_CREATED" } });
        }
        const income = await readIncome(delivery, row);
        if (!income?.eventId) throw new Error("Receita criada; aguardando o evento financeiro do CA. Verifique novamente.");
        const installmentId = await installmentFor(delivery, income.eventId, row);
        const existingSettlement = await settlementFor(delivery, installmentId, row);
        if (existingSettlement) { await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, settlementId: existingSettlement, status: "SENT", lastError: null } }); continue; }
        await assertLease();
        await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { installmentId, status: "SETTLING" } });
        let response;
        try { response = object(await contaAzulRequest(draft.clientId, `/v1/financeiro/eventos-financeiros/parcelas/${installmentId}/baixa`, { method: "POST", body: JSON.stringify({ data_pagamento: row.date, conta_financeira: row.accountId, composicao_valor: { valor_bruto: row.amountCents / 100, juros: 0, multa: 0, desconto: 0, taxa: 0 }, metodo_pagamento: "OUTRO", observacao: delivery.marker }) })); }
        catch (error) { await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: definiteRejection(error) ? "RECEIVABLE_CREATED" : "UNCERTAIN_SETTLEMENT", lastError: "Receita criada, mas a baixa não foi confirmada. Verifique antes de retomar." } }); throw new Error("A baixa não foi confirmada."); }
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
