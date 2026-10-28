import "server-only";
import { getCurrentMember, getRolePermissions } from "@/modules/permissions/permissions";
import { prisma } from "@/lib/prisma";
import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import { apiItems, contaAzulOptions } from "@/modules/conta-azul/financial-export";
import { type ImportKind, type Review, digits, reviewIssues, schedule, monthDate } from "./model";
import { closingAccountBalance } from "./account-balance";
import { compareBalances, type AccountClosingBalance } from "./balance-model";

export const kindPermission = (kind: ImportKind) => kind === "INVESTMENT" ? "INVESTMENT_INCOME" : "CONTRACT_IMPORTS";
export async function importAccess(kind: ImportKind) {
  const member = await getCurrentMember();
  if (!member) return null;
  const permissions = await getRolePermissions(member.organizationId, member.role);
  return { member, permission: permissions[kindPermission(kind)] };
}
export function authorizedCompany(organizationId: string, clientId: string) {
  return prisma.client.findFirst({ where: { id: clientId, organizationId, active: true }, select: { id: true, name: true, document: true } });
}
async function readCatalog(clientId: string, path: string, filters: Record<string, string>) {
  const items: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= 30; page++) {
    const body = await contaAzulRequest<unknown>(clientId, `${path}?${new URLSearchParams({ ...filters, pagina: String(page), tamanho_pagina: "100" })}`);
    const rows = apiItems(body);
    if (!Array.isArray(body) && (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).itens))) throw new Error("Catálogo do CA indisponível.");
    items.push(...rows);
    const metadata = body as Record<string, unknown>;
    const total = metadata.itens_totais ?? metadata.total_itens;
    if (typeof total === "number" ? items.length >= total : rows.length < 100) return items;
    if (!rows.length) throw new Error("Catálogo do CA incompleto.");
  }
  throw new Error("Catálogo excede o limite de consulta.");
}
export async function importOptions(clientId: string, kind: ImportKind, term = "", salesCatalogs = true) {
  // Sequential requests share the existing OAuth refresh lock.
  const categories = contaAzulOptions(await contaAzulRequest(clientId, "/v1/categorias?pagina=1&tamanho_pagina=1000")).filter((item) => !item.type || item.type === "RECEITA");
  const financialAccounts = contaAzulOptions(apiItems(await contaAzulRequest(clientId, "/v1/conta-financeira?pagina=1&tamanho_pagina=1000&apenas_ativo=true")).filter((item) => item.ativo !== false));
  let customers: Array<{ value: string; label: string; document: string }> = [];
  if (kind === "CONTRACT" || kind === "INVESTMENT" && salesCatalogs) {
    const query = new URLSearchParams({ pagina: "1", tamanho_pagina: "1000", tipo_perfil: "CLIENTE", status: "ATIVO" });
    if (term.trim()) query.set("termo_busca", term.trim());
    const body = kind === "INVESTMENT" ? await readCatalog(clientId, "/v1/pessoa", { tipo_perfil: "CLIENTE", status: "ATIVO" }) : await contaAzulRequest(clientId, `/v1/pessoa?${query}`);
    customers = apiItems(body).flatMap((item) => {
      const value = String(item.id || item.uuid || "");
      const label = String(item.nome || item.razao_social || "");
      return value && label ? [{ value, label, document: digits(String(item.documento || item.cpf_cnpj || "")) }] : [];
    });
  }
  const services = kind === "INVESTMENT" && salesCatalogs ? contaAzulOptions((await readCatalog(clientId, "/v1/servicos", {})).filter((item) => item.status === "ATIVO" && item.tipo_servico !== "TOMADO")) : [];
  return { categories, financialAccounts, customers, services };
}
export async function simulateReview(clientId: string, review: Review) {
  const options = await importOptions(clientId, review.kind, review.kind === "CONTRACT" ? review.buyerDocument : "");
  const errors = reviewIssues(review, true);
  const rows = review.kind === "INVESTMENT" ? review.rows : [review];
  for (const row of rows) {
    if (!options.categories.some((item) => item.value === row.categoryId)) errors.push("Categoria não encontrada entre as receitas da empresa selecionada.");
    if (!options.financialAccounts.some((item) => item.value === row.accountId)) errors.push("Conta financeira não encontrada na empresa selecionada.");
  }
  if (review.kind === "CONTRACT") {
    const company = await prisma.client.findUnique({ where: { id: clientId }, select: { document: true } });
    if (!review.sellerDocument || digits(company?.document || "") !== digits(review.sellerDocument)) errors.push("A empresa selecionada não corresponde ao CNPJ da contratada no documento.");
    const customer = options.customers.find((item) => item.value === review.customerId);
    if (!customer || customer.document !== digits(review.buyerDocument)) errors.push("O comprador selecionado no CA não corresponde ao CPF/CNPJ do contrato.");
  }
  const balances: AccountClosingBalance[] = [];
  if (review.kind === "INVESTMENT") {
    if (!options.customers.some((item) => item.value === review.customerId)) errors.push("Cliente da venda não encontrado na empresa selecionada.");
    if (!options.services.some((item) => item.value === review.serviceId)) errors.push("Serviço da venda não encontrado ou inativo na empresa selecionada.");
    const deadline = Date.now() + 220000;
    for (const accountId of new Set(review.rows.map((row) => row.accountId).filter(Boolean))) {
      if (options.financialAccounts.some((item) => item.value === accountId)) balances.push(await closingAccountBalance(clientId, accountId, review.periodEnd, new Date(), deadline));
    }
    for (const comparison of compareBalances(review, balances)) {
      const label = options.financialAccounts.find((item) => item.value === comparison.accountId)?.label || "Conta";
      if (comparison.status === "DIVERGENT") errors.push(`${label}: o saldo após o rendimento diverge do saldo bruto do extrato.`);
      if (comparison.status === "ALREADY_MATCHES") errors.push(`${label}: o saldo já confere sem novo lançamento; verifique possível rendimento já registrado.`);
      if (comparison.status === "UNAVAILABLE") errors.push(`${label}: não foi possível validar o fechamento. Confira a data de apuração e a disponibilidade dos movimentos.`);
    }
  }
  const sales = review.kind === "CONTRACT" ? schedule(review) : review.rows.map((row, i) => ({ number: i + 1, description: row.description, saleDate: row.date, dueDate: row.date, amountCents: row.amountCents }));
  return { mode: "SIMULATION", validatedAt: new Date().toISOString(), errors: [...new Set(errors)], sales, totalCents: sales.reduce((sum, row) => sum + row.amountCents, 0),
    endDate: review.kind === "CONTRACT" && sales.length ? monthDate(sales[sales.length - 1].saleDate, 0, "last") : null,
    writesToContaAzul: 0,
    balances,
  };
}
