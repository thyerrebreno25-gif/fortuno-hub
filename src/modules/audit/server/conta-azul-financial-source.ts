import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import type { ContaAzulAuditEntry } from "../financial-history-engine";

type ApiRecord = Record<string, unknown>;

function apiItems(body: unknown): ApiRecord[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  for (const value of [body.itens, body.items, body.data, body.conteudo]) {
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstString(record: ApiRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/[^0-9,.-]/g, "");
  const parsed = Number(cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function names(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const name = firstString(item, ["nome", "descricao", "name"]);
    return name ? [name] : [];
  });
}

function contactName(item: ApiRecord, flow: ContaAzulAuditEntry["flow"]) {
  const contact = flow === "PAYABLE" ? item.fornecedor : item.cliente;
  if (!isRecord(contact)) return firstString(item, ["nome_contato", "contato", "fornecedor", "cliente"]);
  return firstString(contact, ["nome", "razao_social", "nome_fantasia", "name"]);
}

function financialEntry(item: ApiRecord, flow: ContaAzulAuditEntry["flow"], fallbackId: string): ContaAzulAuditEntry | null {
  const dueDate = firstString(item, ["data_vencimento", "vencimento"]);
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) return null;
  const total = numberValue(item.total ?? item.valor ?? item.valor_bruto);
  const paid = numberValue(item.pago ?? item.valor_pago ?? item.recebido);
  const outstandingSource = item.nao_pago ?? item.valor_em_aberto ?? item.saldo;
  const outstanding = outstandingSource == null
    ? Math.max(0, total - paid)
    : numberValue(outstandingSource);
  return {
    id: firstString(item, ["id", "uuid", "id_parcela", "id_evento"]) || fallbackId,
    flow,
    description: firstString(item, ["descricao", "nome", "observacao", "referencia"]) || "Sem descrição",
    counterparty: contactName(item, flow),
    categories: names(item.categorias ?? item.categorias_rateio ?? item.rateio),
    costCenters: names(item.centros_custo ?? item.centros_de_custo),
    dueDate: dueDate.slice(0, 10),
    competenceDate: firstString(item, ["data_competencia", "competencia"])?.slice(0, 10) || null,
    status: firstString(item, ["status_traduzido", "status", "situacao"]) || "NÃO INFORMADO",
    total,
    paid,
    outstanding,
  };
}

async function fetchFlow(
  clientId: string,
  flow: ContaAzulAuditEntry["flow"],
  start: string,
  end: string,
) {
  const entries: ContaAzulAuditEntry[] = [];
  const kind = flow === "PAYABLE" ? "contas-a-pagar" : "contas-a-receber";
  const pageSize = 1000;

  for (let page = 1; page <= 25; page += 1) {
    const params = new URLSearchParams({
      pagina: String(page),
      tamanho_pagina: String(pageSize),
      data_vencimento_de: start,
      data_vencimento_ate: end,
    });
    const body = await contaAzulRequest<unknown>(
      clientId,
      `/v1/financeiro/eventos-financeiros/${kind}/buscar?${params.toString()}`,
    );
    const items = apiItems(body);
    items.forEach((item, index) => {
      const entry = financialEntry(item, flow, `${flow}-${page}-${index}`);
      if (entry) entries.push(entry);
    });
    if (items.length < pageSize) break;
  }

  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

export async function fetchContaAzulAuditPeriod(
  clientId: string,
  start: string,
  end: string,
) {
  // As consultas permanecem sequenciais porque o refresh token do Conta Azul é rotativo.
  const payable = await fetchFlow(clientId, "PAYABLE", start, end);
  const receivable = await fetchFlow(clientId, "RECEIVABLE", start, end);
  return { payable, receivable, all: [...payable, ...receivable] };
}
