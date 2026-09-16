import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { sendNewSupportTicketEmail } from "@/modules/notifications/email/support-email";
import { apiItems } from "@/modules/conta-azul/financial-export";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import {
  assistantClientAccessWhere,
  findAssistantClient,
  type AssistantMember,
} from "./auth";
import { searchPlatformGuide } from "./platform-knowledge";
import { startCategoryHistory } from "./category-history-server";

export type AssistantToolContext = {
  member: AssistantMember;
  conversationId: string;
};

type SupportPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export const ASSISTANT_TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "preview_invoice_category_learning",
    description: "Consulta o histórico de despesas de uma conta/cartão do Conta Azul e cria uma prévia de aprendizado de categorias para próximas faturas. Não salva regras nem altera lançamentos. O usuário conclui a consulta e confirma no cartão de prévia exibido na conversa.",
    parameters: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "ID do cliente selecionado ou obtido em search_clients." },
        financial_account_id: { type: "string", description: "ID real da conta/cartão obtido em get_client_conta_azul_catalog financial_accounts. Nunca invente; se há várias contas compatíveis, pergunte qual usar." },
        period_start: { type: "string", description: "Data inicial de VENCIMENTO, AAAA-MM-DD." },
        period_end: { type: "string", description: "Data final de VENCIMENTO, AAAA-MM-DD. Até 93 dias por consulta." },
      },
      required: ["client_id", "financial_account_id", "period_start", "period_end"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_platform_guide",
    description: "Consulta como um módulo ou fluxo do Fortuno Hub funciona.",
    parameters: {
      type: "object",
      properties: { topic: { type: "string", description: "Assunto pesquisado." } },
      required: ["topic"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "search_clients",
    description: "Localiza clientes que o usuário autenticado tem permissão para consultar.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Nome ou documento, completo ou parcial." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_client_overview",
    description: "Consulta cadastro, responsáveis, conexão Conta Azul e situação operacional resumida de um cliente.",
    parameters: {
      type: "object",
      properties: { client_id: { type: "string", description: "ID obtido em search_clients." } },
      required: ["client_id"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_client_conta_azul_catalog",
    description: "Consulta categorias, centros de custo ou contas financeiras cadastrados no Conta Azul do cliente.",
    parameters: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "ID obtido em search_clients." },
        catalog: { type: "string", enum: ["categories", "cost_centers", "financial_accounts"] },
        query: { type: "string", description: "Filtro opcional pelo nome." },
      },
      required: ["client_id", "catalog", "query"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "audit_client_financials",
    description: "Consulta no Conta Azul contas a pagar, contas a receber e saldos das contas financeiras, além das pendências internas, para uma auditoria preliminar.",
    parameters: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "ID obtido em search_clients." },
        period_start: { type: "string", description: "Data inicial no formato AAAA-MM-DD." },
        period_end: { type: "string", description: "Data final no formato AAAA-MM-DD." },
      },
      required: ["client_id", "period_start", "period_end"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "create_support_ticket",
    description: "Cria um chamado de suporte somente quando o usuário pedir explicitamente ou quando um arquivo de adquirente tiver layout não reconhecido.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
        module: { type: "string" },
        client_id: { type: ["string", "null"] },
      },
      required: ["subject", "description", "priority", "module", "client_id"],
      additionalProperties: false,
    },
  },
] as const;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return null;
}

function financialRow(item: Record<string, unknown>) {
  const detail = item.detalhe_valor && typeof item.detalhe_valor === "object"
    ? item.detalhe_valor as Record<string, unknown>
    : {};
  const value = [
    item.valor,
    item.valor_liquido,
    item.valor_bruto,
    item.valor_original,
    detail.valor_liquido,
    detail.valor_bruto,
  ].map(parseMoney).find((candidate) => candidate !== null) ?? 0;
  const contact = item.contato && typeof item.contato === "object"
    ? item.contato as Record<string, unknown>
    : {};
  return {
    id: firstString(item, ["id", "uuid", "id_evento", "id_parcela"]),
    description: firstString(item, ["descricao", "nome", "observacao", "referencia"]) || "Sem descrição",
    contact: firstString(contact, ["nome", "razao_social"]) || firstString(item, ["nome_contato"]),
    status: firstString(item, ["status", "situacao"]) || "NÃO INFORMADO",
    competenceDate: firstString(item, ["data_competencia"]),
    dueDate: firstString(item, ["data_vencimento", "vencimento"]),
    paymentDate: firstString(item, ["data_pagamento", "pagamento"]),
    amount: Math.round(value * 100) / 100,
    reconciled: typeof item.conciliado === "boolean" ? item.conciliado : null,
  };
}

function summarizeFinancialRows(rows: ReturnType<typeof financialRow>[]) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map<string, { count: number; amount: number }>();
  rows.forEach((row) => {
    const key = normalize(row.status).toUpperCase() || "NÃO INFORMADO";
    const current = groups.get(key) ?? { count: 0, amount: 0 };
    current.count += 1;
    current.amount = Math.round((current.amount + Math.abs(row.amount)) * 100) / 100;
    groups.set(key, current);
  });
  const openStatuses = new Set(["PENDENTE", "EM ABERTO", "ABERTO", "VENCIDO", "ATRASADO"]);
  const overdue = rows.filter((row) => {
    const status = normalize(row.status).toUpperCase();
    return Boolean(row.dueDate && row.dueDate < today && openStatuses.has(status));
  });
  return {
    count: rows.length,
    amount: Math.round(rows.reduce((sum, row) => sum + Math.abs(row.amount), 0) * 100) / 100,
    byStatus: Object.fromEntries(groups),
    overdueCount: overdue.length,
    overdueAmount: Math.round(overdue.reduce((sum, row) => sum + Math.abs(row.amount), 0) * 100) / 100,
  };
}

function validatePeriod(start: unknown, end: unknown) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof start !== "string" || typeof end !== "string" || !pattern.test(start) || !pattern.test(end)) {
    throw new Error("Informe o período no formato AAAA-MM-DD.");
  }
  const startDate = new Date(`${start}T12:00:00.000Z`);
  const endDate = new Date(`${end}T12:00:00.000Z`);
  if (startDate > endDate) throw new Error("A data inicial não pode ser posterior à data final.");
  const days = (endDate.getTime() - startDate.getTime()) / 86_400_000;
  if (days > 366) throw new Error("A auditoria pelo assistente aceita períodos de até 366 dias.");
  return { start, end };
}

async function searchClients(member: AssistantMember, query: string) {
  const term = query.trim();
  return prisma.client.findMany({
    where: {
      organizationId: member.organizationId,
      active: true,
      ...assistantClientAccessWhere(member),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: "insensitive" } },
              { document: { contains: term } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 20,
    select: {
      id: true,
      name: true,
      document: true,
      contaAzulConnection: { select: { active: true, status: true } },
    },
  });
}

async function getClientOverview(member: AssistantMember, clientId: string) {
  const client = await findAssistantClient(member, clientId);
  if (!client) throw new Error("Cliente não encontrado ou fora da sua responsabilidade.");
  const details = await prisma.client.findUnique({
    where: { id: client.id },
    select: {
      id: true,
      name: true,
      document: true,
      cluster: true,
      operationalEmail: true,
      serviceSquad: true,
      operationLeader: { select: { name: true, email: true } },
      payableResponsible: { select: { name: true, email: true } },
      receivableResponsible: { select: { name: true, email: true } },
      generalResponsible: { select: { name: true, email: true } },
      contaAzulConnection: {
        select: { status: true, active: true, externalTenantName: true, lastSyncAt: true, lastError: true },
      },
      _count: { select: { banks: true, cards: true, acquirers: true, imports: true, audits: true } },
      imports: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { module: true, status: true, originalName: true, createdAt: true },
      },
      audits: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, status: true, healthScore: true, referenceLabel: true, createdAt: true },
      },
    },
  });
  return details;
}

async function getClientContaAzulCatalog(
  member: AssistantMember,
  clientId: string,
  catalog: string,
  query: string,
) {
  const client = await findAssistantClient(member, clientId);
  if (!client) throw new Error("Cliente não encontrado ou fora da sua responsabilidade.");
  const connection = await prisma.contaAzulConnection.findFirst({
    where: { clientId, organizationId: member.organizationId, active: true, status: "CONNECTED" },
    select: { externalTenantName: true },
  });
  if (!connection) throw new Error("Este cliente não possui conexão ativa com o Conta Azul.");
  const endpoints: Record<string, string> = {
    categories: "/v1/categorias?pagina=1&tamanho_pagina=1000",
    cost_centers: "/v1/centro-de-custo?pagina=1&tamanho_pagina=1000",
    financial_accounts: "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true",
  };
  const endpoint = endpoints[catalog];
  if (!endpoint) throw new Error("Cadastro do Conta Azul não reconhecido.");
  const term = normalize(query);
  const items = apiItems(await contaAzulRequest<unknown>(clientId, endpoint))
    .map((item) => ({
      id: firstString(item, ["id", "uuid", "id_categoria", "id_centro_custo", "id_conta_financeira"]),
      name: firstString(item, ["nome", "descricao", "name"]) || "Sem nome",
      type: firstString(item, ["tipo", "tipo_categoria", "type"]),
      active: typeof item.ativo === "boolean" ? item.ativo : null,
    }))
    .filter((item) => !term || normalize(item.name).includes(term))
    .slice(0, 250);
  return {
    client,
    contaAzulTenant: connection.externalTenantName,
    catalog,
    query: query || null,
    count: items.length,
    items,
    truncated: items.length === 250,
  };
}

async function fetchFinancialPage(
  clientId: string,
  direction: "payable" | "receivable",
  start: string,
  end: string,
  page: number,
) {
  const params = new URLSearchParams({
    pagina: String(page),
    tamanho_pagina: "100",
    data_vencimento_de: start,
    data_vencimento_ate: end,
  });
  const kind = direction === "payable" ? "contas-a-pagar" : "contas-a-receber";
  return contaAzulRequest<unknown>(
    clientId,
    `/v1/financeiro/eventos-financeiros/${kind}/buscar?${params.toString()}`,
  );
}

async function fetchFinancialRows(
  clientId: string,
  direction: "payable" | "receivable",
  start: string,
  end: string,
) {
  const rows: ReturnType<typeof financialRow>[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await fetchFinancialPage(clientId, direction, start, end, page);
    const items = apiItems(body);
    rows.push(...items.map(financialRow));
    if (items.length < 100) break;
  }
  return rows;
}

async function fetchAccountBalances(clientId: string) {
  const body = await contaAzulRequest<unknown>(
    clientId,
    "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true",
  );
  const accounts = apiItems(body).slice(0, 30);
  const output: Array<{ id: string; name: string; balance: number | null; error?: string }> = [];
  for (const account of accounts) {
    const id = firstString(account, ["id", "uuid", "id_conta_financeira"]);
    const name = firstString(account, ["nome", "descricao", "name"]) || "Conta sem nome";
    if (!id) continue;
    try {
      const balance = await contaAzulRequest<Record<string, unknown>>(
        clientId,
        `/v1/conta-financeira/${id}/saldo-atual`,
      );
      output.push({ id, name, balance: parseMoney(balance.saldo_atual) });
    } catch (error) {
      output.push({ id, name, balance: null, error: error instanceof Error ? error.message : "Saldo indisponível" });
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return output;
}

async function auditClientFinancials(
  member: AssistantMember,
  clientId: string,
  start: string,
  end: string,
) {
  const client = await findAssistantClient(member, clientId);
  if (!client) throw new Error("Cliente não encontrado ou fora da sua responsabilidade.");
  const connection = await prisma.contaAzulConnection.findFirst({
    where: { clientId, organizationId: member.organizationId, active: true, status: "CONNECTED" },
    select: { id: true, externalTenantName: true, lastSyncAt: true },
  });
  if (!connection) throw new Error("Este cliente não possui conexão ativa com o Conta Azul.");
  const period = validatePeriod(start, end);

  // Chamadas sequenciais evitam disputa na renovação do refresh token rotativo.
  const payables = await fetchFinancialRows(clientId, "payable", period.start, period.end);
  const receivables = await fetchFinancialRows(clientId, "receivable", period.start, period.end);
  const accountBalances = await fetchAccountBalances(clientId);
  const [openOperations, overdueOperations, activeAudits, openFindings, recentImports] = await Promise.all([
    prisma.operationActivity.count({ where: { clientId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } } }),
    prisma.operationActivity.count({ where: { clientId, deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] }, dueAt: { lt: new Date() } } }),
    prisma.audit.count({ where: { clientId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    prisma.auditFinding.count({ where: { audit: { clientId }, status: { in: ["IDENTIFIED", "SENT", "IN_PROGRESS"] } } }),
    prisma.importJob.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { module: true, status: true, originalName: true, createdAt: true },
    }),
  ]);

  return {
    client,
    source: {
      contaAzulTenant: connection.externalTenantName,
      queriedAt: new Date().toISOString(),
      periodBasis: "vencimento",
      period,
      limitations: [
        "Auditoria preliminar: não substitui conferência documental ou extrato bancário.",
        "O período dos eventos financeiros foi filtrado pela data de vencimento exigida pela API.",
        "Recorrências de água, energia e internet exigem histórico suficiente e descrições consistentes.",
      ],
    },
    payables: {
      ...summarizeFinancialRows(payables),
      items: payables.slice(0, 100),
      truncated: payables.length > 100,
    },
    receivables: {
      ...summarizeFinancialRows(receivables),
      items: receivables.slice(0, 100),
      truncated: receivables.length > 100,
    },
    accountBalances,
    fortuno: { openOperations, overdueOperations, activeAudits, openFindings, recentImports },
  };
}

export async function createAssistantSupportTicket(input: {
  context: AssistantToolContext;
  subject: string;
  description: string;
  priority?: string;
  module?: string;
  clientId?: string | null;
  attachments?: Array<Record<string, unknown>>;
  technicalContext?: Record<string, unknown>;
}) {
  const { member, conversationId } = input.context;
  const priority: SupportPriority = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(input.priority || "")
    ? input.priority as SupportPriority
    : "MEDIUM";
  let client: { id: string; name: string } | null = null;
  if (input.clientId) {
    const allowed = await findAssistantClient(member, input.clientId);
    if (!allowed) throw new Error("Cliente não encontrado ou fora da sua responsabilidade.");
    client = { id: allowed.id, name: allowed.name };
  }
  const subject = input.subject.trim().slice(0, 180);
  const description = input.description.trim().slice(0, 5000);
  if (subject.length < 4 || description.length < 10) throw new Error("Título ou descrição do chamado estão incompletos.");
  const existing = await prisma.supportTicket.findFirst({
    where: {
      organizationId: member.organizationId,
      userId: member.userId,
      subject,
      status: { in: ["OPEN", "IN_PROGRESS"] },
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, code: `SUP-${existing.id.slice(-6).toUpperCase()}`, duplicatePrevented: true };

  const ticket = await prisma.$transaction(async (transaction) => {
    const created = await transaction.supportTicket.create({
      data: {
        organizationId: member.organizationId,
        userId: member.userId,
        subject,
        description,
        priority,
        status: "OPEN",
        metadata: asJson({
          category: "Leitor não configurado",
          module: input.module?.trim() || "Assistente Fortuno",
          attachments: input.attachments || [],
          technicalContext: {
            assistantConversationId: conversationId,
            client,
            ...(input.technicalContext || {}),
          },
          messages: [{
            id: crypto.randomUUID(),
            userId: member.userId,
            userName: member.user.name || member.user.email,
            senderType: "USER",
            text: description,
            createdAt: new Date().toISOString(),
            attachments: input.attachments || [],
          }],
        }),
      },
    });
    await transaction.auditLog.create({
      data: {
        userId: member.userId,
        action: "ASSISTANT_SUPPORT_TICKET_CREATED",
        entity: "SupportTicket",
        entityId: created.id,
        afterData: asJson({ subject, priority, client, conversationId }),
      },
    });
    return created;
  });
  const code = `SUP-${ticket.id.slice(-6).toUpperCase()}`;
  void sendNewSupportTicketEmail({
    ticketId: ticket.id,
    ticketCode: code,
    subject,
    description,
    priority,
    category: "Leitor não configurado",
    module: input.module?.trim() || "Assistente Fortuno",
    requesterName: member.user.name || member.user.email,
    requesterEmail: member.user.email,
    createdAt: ticket.createdAt,
  }).catch((error) => console.error("Falha ao notificar chamado do assistente:", error));
  return { id: ticket.id, code, duplicatePrevented: false };
}

function objectArguments(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export async function executeAssistantTool(
  context: AssistantToolContext,
  name: string,
  rawArguments: string,
) {
  const args = objectArguments(rawArguments);
  if (name === "preview_invoice_category_learning") {
    const result = await startCategoryHistory({ member: context.member, conversationId: context.conversationId,
      clientId: String(args.client_id || ""), accountId: String(args.financial_account_id || ""),
      start: String(args.period_start || ""), end: String(args.period_end || "") });
    return { previewMessageId: result.previewMessageId, client: result.preview.client, account: result.preview.account,
      period: result.preview.period, processedCount: result.preview.processedCount, total: result.preview.total,
      complete: result.preview.complete, saved: false,
      nextAction: result.preview.complete ? "Peça ao usuário para revisar e confirmar no cartão de aprendizado da conversa." : "Peça ao usuário para clicar Concluir consulta no cartão de aprendizado da conversa. O histórico ainda está incompleto.",
      counts: result.preview.complete ? { ready: result.preview.candidates.filter((item) => item.status === "READY").length,
        review: result.preview.candidates.filter((item) => item.status === "CONFLICT").length,
        preserved: result.preview.candidates.filter((item) => item.status === "PRESERVED").length } : null,
      examples: result.preview.candidates.slice(0, 5).map((item) => ({ description: item.description, status: item.status, categories: item.options.map((option) => option.category) })) };
  }
  if (name === "get_platform_guide") return searchPlatformGuide(String(args.topic || ""));
  if (name === "search_clients") return searchClients(context.member, String(args.query || ""));
  if (name === "get_client_overview") return getClientOverview(context.member, String(args.client_id || ""));
  if (name === "get_client_conta_azul_catalog") {
    return getClientContaAzulCatalog(
      context.member,
      String(args.client_id || ""),
      String(args.catalog || ""),
      String(args.query || ""),
    );
  }
  if (name === "audit_client_financials") {
    return auditClientFinancials(
      context.member,
      String(args.client_id || ""),
      String(args.period_start || ""),
      String(args.period_end || ""),
    );
  }
  if (name === "create_support_ticket") {
    return createAssistantSupportTicket({
      context,
      subject: String(args.subject || ""),
      description: String(args.description || ""),
      priority: String(args.priority || "MEDIUM"),
      module: String(args.module || "Assistente Fortuno"),
      clientId: typeof args.client_id === "string" ? args.client_id : null,
    });
  }
  throw new Error(`Ferramenta desconhecida: ${name}`);
}
