import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { contaAzulRequest, ContaAzulApiError } from "@/modules/purchase-invoices/server/conta-azul";
import { contractSchema, digits, monthDate, normalize, reviewIssues, schedule, type ContractReview } from "./model";
import { simulateReview } from "./server";
import { ensureContractBuyer } from "./contract-buyer";
import { contractRejection } from "./contract-errors";
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
export function contractBusinessKey(org: string, client: string, review: ContractReview) {
  return createHash("sha256").update(JSON.stringify(["CONTRACT", org, client, digits(review.buyerDocument), normalize(review.description), review.originalDate, review.startMonth, review.amountCents, review.installments, review.frequency, review.interval])).digest("hex");
}
export function contractPayload(review: ContractReview, number: number, marker: string) {
  const issues = reviewIssues(review, true);
  if (![review.customerId, review.serviceId, review.categoryId, review.accountId].every(uuid)) issues.push("Os cadastros do CA devem possuir identificadores válidos.");
  if (!Number.isSafeInteger(number) || number < 1) issues.push("O CA não informou um número válido para o contrato.");
  if (issues.length) throw new Error(issues.join(" "));
  const sales = schedule(review);
  return { id_cliente: review.customerId, id_categoria: review.categoryId, data_emissao: review.startMonth,
    observacoes: `${marker} | ${review.description}`, observacoes_pagamento: marker,
    termos: { tipo_frequencia: review.frequency === "YEARLY" ? "ANUAL" : "MENSAL", tipo_expiracao: "DATA", data_inicio: review.startMonth, data_fim: monthDate(sales.at(-1)!.saleDate, 0, "last"), intervalo_frequencia: review.interval, dia_emissao_venda: 1, numero: number },
    condicao_pagamento: { tipo_pagamento: review.paymentMethod, id_conta_financeira: review.accountId, dia_vencimento: review.dueDay, primeira_data_vencimento: review.firstDueDate },
    itens: [{ id: review.serviceId, descricao: review.description, quantidade: 1, valor: review.amountCents / 100 }],
  };
}
export async function confirmContract(clientId: string, review: ContractReview, contractId: string, number: number) {
  const sales = schedule(review);
  for (let page = 1; page <= 20; page++) {
    const query = new URLSearchParams({ pagina: String(page), tamanho_pagina: "50", cliente_id: review.customerId, data_inicio: review.startMonth, data_fim: monthDate(sales.at(-1)!.saleDate, 0, "last") });
    const body = await contaAzulRequest(clientId, "/v1/contratos?" + query);
    const root = object(body);
    const list = Array.isArray(body) ? body : [root.items, root.itens, root.content, root.conteudo, root.data].find(Array.isArray);
    const total = [root.itens_totais, root.totalItems, root.totalElements].find(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) as number | undefined;
    if (!list && total !== 0) throw new Error("O CA retornou uma consulta de contratos inválida. O contrato criado foi preservado; nenhuma nova criação será feita.");
    const rows = (list || []).map(object);
    if (rows.some(row => !uuid(row.id))) throw new Error("O CA retornou contratos sem identificadores válidos.");
    const match = rows.find(row => row.id === contractId);
    if (match) {
      if (object(match.cliente).id !== review.customerId || match.numero !== number || String(match.data_inicio).slice(0,10) !== review.startMonth) throw new Error("O contrato retornado pelo CA diverge da revisão. Confira no CA antes de continuar.");
      return true;
    }
    if (total !== undefined && page * 50 >= total) return false;
    if (rows.length < 50 && total === undefined) return false;
    if (!rows.length) throw new Error("O CA retornou uma paginação de contratos incompleta. Verifique novamente mais tarde.");
  }
  throw new Error("A consulta de confirmação dos contratos excedeu o limite. Nenhum novo contrato será enviado.");
}
export async function sendContractReview(input: { organizationId: string; userId: string; reviewId: string; version: number; verifyOnly?: boolean }) {
  const draft = await prisma.documentImportReview.findFirst({ where: { id: input.reviewId, organizationId: input.organizationId, kind: "CONTRACT" } });
  if (!draft) throw new Error("Revisão de contrato não encontrada.");
  const token = randomUUID();
  await prisma.documentImportDispatchLease.upsert({ where: { clientId: draft.clientId }, create: { clientId: draft.clientId, organizationId: input.organizationId, token: "", expiresAt: new Date(0) }, update: {} });
  const locked = await prisma.documentImportDispatchLease.updateMany({ where: { clientId: draft.clientId, organizationId: input.organizationId, expiresAt: { lte: new Date() } }, data: { token, expiresAt: new Date(Date.now() + 10 * 60000) } });
  if (!locked.count) throw new Error("Já há um envio desta empresa em andamento. Aguarde para retomar.");
  try {
    const current = await prisma.documentImportReview.findFirst({ where: { id: draft.id, organizationId: input.organizationId, version: input.version } });
    if (!current) throw new Error("A revisão foi alterada. Recarregue antes de enviar.");
    const review = contractSchema.parse(current.data);
    let delivery = await prisma.documentImportDelivery.findFirst({ where: { reviewId: draft.id, organizationId: input.organizationId } });
    if (input.verifyOnly && !delivery?.contractId) throw new Error("Não há contrato criado para verificar. Nenhum envio foi realizado.");
    if (delivery?.status === "SENT") return { completed: true };
    if (!delivery) {
      const validation = await simulateReview(draft.clientId, review);
      if (validation.errors.length) throw new Error(validation.errors.join(" "));
      contractPayload({ ...review, customerId: review.customerId || "00000000-0000-4000-8000-000000000000" }, 1, "validation");
      if (!review.customerId && review.autoCreateBuyer !== false) review.customerId = await ensureContractBuyer(input.organizationId, draft.clientId, review, input.userId);
      // Validate identifiers before reserving the review or querying the next number.
      contractPayload(review, 1, "validation");
      const businessKey = contractBusinessKey(input.organizationId, draft.clientId, review);
      delivery = await prisma.$transaction(async tx => {
        const existing = await tx.documentImportDelivery.findUnique({ where: { businessKey } });
        if (existing) throw new Error("Este contrato já possui envio em outro arquivo. Abra a revisão original para evitar duplicidade.");
        const frozen = await tx.documentImportReview.updateMany({ where: { id: draft.id, organizationId: input.organizationId, version: input.version, deliveries: { none: {} } }, data: { status: "SENDING", data: review as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
        if (!frozen.count) throw new Error("A revisão mudou durante a conferência. Recarregue.");
        const saved = await tx.documentImportDelivery.create({ data: { organizationId: input.organizationId, clientId: draft.clientId, reviewId: draft.id, rowKey: "CONTRACT", businessKey, marker: `FORTUNO-CONT-${businessKey.slice(0,24)}`, payload: { flow: "CONTRACT", review } as unknown as Prisma.InputJsonValue } });
        await tx.auditLog.create({ data: { userId: input.userId, action: "CONTRACT_SEND_CONFIRMED", entity: "DocumentImportReview", entityId: draft.id, afterData: { clientId: draft.clientId, totalCents: review.totalCents, installments: review.installments, version: input.version } } });
        return saved;
      });
    }
    if (object(delivery.payload).flow !== "CONTRACT") throw new Error("O envio existente não pertence ao fluxo de contratos.");
    if (!delivery.contractId) {
      if (!["PENDING", "FAILED"].includes(delivery.status)) throw new Error("A criação do contrato está incerta. Confira no CA; nenhum novo contrato será criado automaticamente.");
      const next = await contaAzulRequest<unknown>(draft.clientId, "/v1/contratos/proximo-numero");
      if (typeof next !== "number" || !Number.isSafeInteger(next) || next < 1) throw new Error("O CA não informou um próximo número válido.");
      const payload = contractPayload(review, next, delivery.marker);
      if (!await prisma.documentImportDispatchLease.findFirst({ where: { clientId: draft.clientId, token, expiresAt: { gt: new Date() } } })) throw new Error("Envio pausado. Atualize o andamento antes de retomar.");
      await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: "CREATING", contractNumber: next, lastError: null } });
      let response: Record<string,unknown>;
      try { response = object(await contaAzulRequest(draft.clientId, "/v1/contratos", { method: "POST", body: JSON.stringify(payload) })); }
      catch (error) {
        const rejected = error instanceof ContaAzulApiError && [400,401,403,404,405,422].includes(error.status);
        const reason = rejected ? contractRejection(error.status, error.responseBody, error.message) : "A criação do contrato ficou incerta. Não repetiremos a criação automaticamente.";
        await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: rejected ? "FAILED" : "UNCERTAIN_CONTRACT", lastError: reason } });
        throw new Error(reason);
      }
      if (!uuid(response.id)) {
        await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: "UNCERTAIN_CONTRACT", lastError: "O CA não retornou o identificador do contrato. Confira manualmente; o POST não será repetido." } });
        throw new Error("O CA não retornou o identificador do contrato. Confira o resultado no CA.");
      }
      delivery = await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { contractId: response.id, contractNumber: next, saleId: uuid(response.id_venda) ? response.id_venda : null, status: "CONTRACT_CREATED", lastError: null } });
    }
    const confirmed = await confirmContract(draft.clientId, review, delivery.contractId!, delivery.contractNumber!);
    await prisma.documentImportDelivery.update({ where: { id: delivery.id }, data: { status: confirmed ? "SENT" : "CONTRACT_CREATED", lastError: confirmed ? null : "Contrato criado; aguardando aparecer na consulta do CA. Use Verificar envio para consultar novamente." } });
    await prisma.documentImportReview.update({ where: { id: draft.id }, data: { status: confirmed ? "SENT" : "SENDING" } });
    return { completed: confirmed };
  } finally { await prisma.documentImportDispatchLease.updateMany({ where: { clientId: draft.clientId, token }, data: { expiresAt: new Date(0) } }); }
}
