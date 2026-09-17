import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { apiItems, contaAzulOptions } from "@/modules/conta-azul/financial-export";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import { findAssistantClient, type AssistantMember } from "./auth";
import {
  HISTORY_PAGE_SIZE, historyPreviewText, publicHistoryPreview, readHistoryPage,
  selectHistoryRules, validateHistoryPeriod,
  type CategoryHistoryPreview, type HistorySelection,
} from "./category-history";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export class CategoryHistoryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export type HistorySurface = "ASSISTANT" | "INVOICE";
const INVOICE_SESSION_TITLE = "Aprendizado de faturas";

async function authorizeClient(member: AssistantMember, clientId: string | undefined, surface: HistorySurface) {
  const permissions = await getRolePermissions(member.organizationId, member.role);
  const modulePermission = surface === "INVOICE" ? permissions.IMPORTS : permissions.ASSISTANT;
  if (!modulePermission?.canView || !(surface === "INVOICE" ? modulePermission.canImport || modulePermission.canEdit : modulePermission.canEdit) || !permissions.CLIENTS.canEdit) {
    throw new CategoryHistoryError("Você não possui permissão para salvar aprendizado deste cliente.", 403);
  }
  if (!clientId) return null;
  const client = await findAssistantClient(member, clientId);
  if (!client) throw new CategoryHistoryError("Cliente não encontrado ou fora da sua responsabilidade.", 403);
  const connection = await prisma.contaAzulConnection.findFirst({
    where: { clientId, organizationId: member.organizationId, active: true, status: "CONNECTED" }, select: { id: true },
  });
  if (!connection) throw new CategoryHistoryError("Conecte este cliente ao Conta Azul para consultar o aprendizado.");
  return client;
}

async function authorize(member: AssistantMember, conversationId: string, clientId?: string, surface: HistorySurface = "ASSISTANT") {
  const client = await authorizeClient(member, clientId, surface);
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id: conversationId, organizationId: member.organizationId, userId: member.userId,
      status: surface === "INVOICE" ? "ARCHIVED" : "ACTIVE",
      ...(surface === "INVOICE" ? { title: INVOICE_SESSION_TITLE, ...(clientId ? { clientId } : {}) } : {}),
    },
    select: { id: true },
  });
  if (!conversation) throw new CategoryHistoryError("Conversa não encontrada.", 404);
  return client;
}

export async function getHistoryAccounts(member: AssistantMember, conversationId: string, clientId: string) {
  await authorize(member, conversationId, clientId);
  return loadAccounts(clientId);
}
export async function getInvoiceHistoryAccounts(member: AssistantMember, clientId: string) {
  await authorizeClient(member, clientId, "INVOICE");
  return loadAccounts(clientId);
}
async function loadAccounts(clientId: string) {
  return apiItems(await contaAzulRequest<unknown>(clientId, "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true", { signal: AbortSignal.timeout(20_000) }))
    .filter((item) => item.ativo !== false)
    .flatMap((item) => {
      const id = item.id ?? item.uuid ?? item.id_conta_financeira;
      const name = item.nome ?? item.descricao;
      return typeof id === "string" && typeof name === "string" ? [{ id, name }] : [];
    });
}

async function loadCatalog(clientId: string) {
  // Renovação rotativa da conexão: não executar chamadas externas em paralelo.
  const categoryBody = await contaAzulRequest<unknown>(clientId, "/v1/categorias?pagina=1&tamanho_pagina=1000", { signal: AbortSignal.timeout(20_000) });
  const centerBody = await contaAzulRequest<unknown>(clientId, "/v1/centro-de-custo?pagina=1&tamanho_pagina=1000", { signal: AbortSignal.timeout(20_000) });
  const categories = new Map(contaAzulOptions(apiItems(categoryBody).filter((item) => item.ativo !== false))
    .filter((option) => !option.type || option.type === "DESPESA").map((option) => [option.value, option.label]));
  const costCenters = new Map(contaAzulOptions(apiItems(centerBody).filter((item) => item.ativo !== false))
    .map((option) => [option.value, option.label]));
  return { categories, costCenters };
}
async function existingRules(clientId: string) {
  return prisma.categoryRule.findMany({ where: { clientId, module: "CREDIT_CARD_INVOICE" },
    select: { normalizedDescription: true, category: true } });
}
async function nextPage(preview: CategoryHistoryPreview) {
  const catalog = await loadCatalog(preview.client.id);
  const existing = await existingRules(preview.client.id);
  return readHistoryPage(preview, {
    ...catalog, existing,
    loadPage: (page) => {
      const params = new URLSearchParams({ pagina: String(page), tamanho_pagina: String(HISTORY_PAGE_SIZE),
        data_vencimento_de: preview.period.start, data_vencimento_ate: preview.period.end,
        ids_contas_financeiras: preview.account.id });
      return contaAzulRequest<unknown>(preview.client.id, `/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?${params}`,
        { signal: AbortSignal.timeout(30_000) });
    },
    loadDetail: (id) => contaAzulRequest<unknown>(preview.client.id,
      `/v1/financeiro/eventos-financeiros/parcelas/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(20_000) }),
  });
}

export async function startCategoryHistory(input: {
  member: AssistantMember; conversationId: string; clientId: string; accountId: string; start: string; end: string;
  surface?: HistorySurface;
}) {
  const surface = input.surface || "ASSISTANT";
  const period = validateHistoryPeriod(input.start, input.end);
  const client = await authorize(input.member, input.conversationId, input.clientId, surface);
  const accounts = await loadAccounts(input.clientId);
  const account = accounts.find((item) => item.id === input.accountId);
  if (!account) throw new CategoryHistoryError("Escolha uma conta/cartão existente no Conta Azul deste cliente.");
  const preview = await nextPage({ version: 1, revision: 0, client: { id: client!.id, name: client!.name }, account,
    period, createdAt: new Date().toISOString(), nextPage: 1, total: null, complete: false, truncated: false,
    seenIds: [], records: [], skipped: 0, candidates: [] });
  const message = await prisma.assistantMessage.create({ data: {
    conversationId: input.conversationId, role: "ASSISTANT", content: historyPreviewText(preview),
    metadata: asJson({ categoryLearningPreview: preview, categoryLearningSurface: surface }),
  }, select: { id: true } });
  await prisma.assistantConversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
  return { previewMessageId: message.id, preview: publicHistoryPreview(preview) };
}

export async function startInvoiceCategoryHistory(input: {
  member: AssistantMember; clientId: string; accountId: string; start: string; end: string;
}) {
  validateHistoryPeriod(input.start, input.end);
  await authorizeClient(input.member, input.clientId, "INVOICE");
  const conversation = await prisma.assistantConversation.create({ data: {
    organizationId: input.member.organizationId, userId: input.member.userId, clientId: input.clientId,
    title: INVOICE_SESSION_TITLE, status: "ARCHIVED",
  }, select: { id: true } });
  return { conversationId: conversation.id, ...await startCategoryHistory({ ...input, conversationId: conversation.id, surface: "INVOICE" }) };
}

async function storedPreview(member: AssistantMember, conversationId: string, messageId: string, surface: HistorySurface, clientId?: string) {
  await authorize(member, conversationId, clientId, surface);
  const message = await prisma.assistantMessage.findFirst({ where: { id: messageId, conversationId, role: "ASSISTANT" },
    select: { id: true, metadata: true } });
  const metadata = message?.metadata as { categoryLearningPreview?: CategoryHistoryPreview; categoryLearningSurface?: HistorySurface } | null;
  const preview = metadata?.categoryLearningPreview;
  if (!message || !preview || preview.version !== 1 || (metadata?.categoryLearningSurface || "ASSISTANT") !== surface || clientId && preview.client.id !== clientId) throw new CategoryHistoryError("Prévia não encontrada.", 404);
  await authorize(member, conversationId, preview.client.id, surface);
  if (!preview.savedAt && Date.now() - Date.parse(preview.createdAt) > 24 * 60 * 60 * 1000) {
    throw new CategoryHistoryError("A prévia expirou. Consulte novamente para usar categorias atualizadas.");
  }
  return { message, preview };
}

export async function continueCategoryHistory(member: AssistantMember, conversationId: string, messageId: string, surface: HistorySurface = "ASSISTANT", clientId?: string) {
  const { preview } = await storedPreview(member, conversationId, messageId, surface, clientId);
  if (preview.complete || preview.savedAt) return { previewMessageId: messageId, preview: publicHistoryPreview(preview) };
  const updated = await nextPage(preview);
  const changed = await prisma.assistantMessage.updateMany({
    where: { id: messageId, metadata: { path: ["categoryLearningPreview", "revision"], equals: preview.revision } },
    data: { content: historyPreviewText(updated), metadata: asJson({ categoryLearningPreview: updated, categoryLearningSurface: surface }) },
  });
  if (changed.count !== 1) throw new CategoryHistoryError("A consulta foi atualizada em outra aba. Reabra a conversa.", 409);
  return { previewMessageId: messageId, preview: publicHistoryPreview(updated) };
}

export async function confirmCategoryHistory(input: {
  member: AssistantMember; conversationId: string; messageId: string; selections: HistorySelection[];
  surface?: HistorySurface; clientId?: string;
}) {
  const surface = input.surface || "ASSISTANT";
  const { preview } = await storedPreview(input.member, input.conversationId, input.messageId, surface, input.clientId);
  if (preview.savedAt) return { savedCount: preview.savedCount || 0, alreadySaved: true, preview: publicHistoryPreview(preview) };
  const catalog = await loadCatalog(preview.client.id);
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.categoryRule.findMany({ where: { clientId: preview.client.id, module: "CREDIT_CARD_INVOICE" },
      select: { normalizedDescription: true, category: true } });
    const selected = selectHistoryRules(preview, input.selections, existing, catalog.categories, catalog.costCenters);
    const savedAt = new Date().toISOString();
    // Compare-and-set impede duas confirmações simultâneas da mesma prévia.
    const claimed = await transaction.assistantMessage.updateMany({
      where: { id: input.messageId, metadata: { path: ["categoryLearningPreview", "revision"], equals: preview.revision } },
      data: { metadata: asJson({ categoryLearningPreview: { ...preview, revision: preview.revision + 1, savedAt }, categoryLearningSurface: surface }) },
    });
    if (claimed.count !== 1) throw new CategoryHistoryError("Esta prévia foi atualizada. Reabra a conversa antes de confirmar.", 409);
    // Nunca atualizar uma regra existente, inclusive se salva manualmente após a prévia.
    const created = await transaction.categoryRule.createMany({ data: selected.rules.map((rule) => ({
      normalizedDescription: rule.normalizedDescription, category: rule.category, costCenter: rule.costCenter,
      clientId: preview.client.id, module: "CREDIT_CARD_INVOICE" as const, confidence: 90,
    })), skipDuplicates: true });
    const updated = { ...preview, revision: preview.revision + 1, savedAt, savedCount: created.count };
    await transaction.assistantMessage.update({ where: { id: input.messageId }, data: { metadata: asJson({ categoryLearningPreview: updated, categoryLearningSurface: surface }) } });
    const content = `Aprendi ${created.count} regra(s) de categoria para ${preview.client.name}. As próximas faturas usarão esse aprendizado. ${selected.preserved + selected.rules.length - created.count} regra(s) existente(s) preservada(s). Nenhum lançamento foi alterado no Conta Azul.`;
    await transaction.assistantMessage.create({ data: { conversationId: input.conversationId, role: "ASSISTANT", content } });
    await transaction.assistantConversation.update({ where: { id: input.conversationId }, data: { updatedAt: new Date() } });
    await transaction.auditLog.create({ data: { userId: input.member.userId, action: "ASSISTANT_INVOICE_CATEGORIES_LEARNED",
      entity: "Client", entityId: preview.client.id,
      afterData: asJson({ conversationId: input.conversationId, previewMessageId: input.messageId, account: preview.account,
        period: preview.period, savedCount: created.count, source: "CONTA_AZUL_HISTORY" }) } });
    return { savedCount: created.count, alreadySaved: false, preview: publicHistoryPreview(updated) };
  });
}
