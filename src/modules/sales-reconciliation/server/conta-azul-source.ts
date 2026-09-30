import { contaAzulRequest } from "@/modules/purchase-invoices/server/conta-azul";
import type { ContaAzulReceivable } from "../types";

type ApiRecord = Record<string, unknown>;

function record(value: unknown): ApiRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ApiRecord : null;
}

function apiItems(body: unknown): ApiRecord[] {
  if (Array.isArray(body)) return body.map(record).filter((item): item is ApiRecord => Boolean(item));
  const source = record(body);
  if (!source) return [];
  for (const value of [source.itens, source.items, source.data, source.conteudo]) {
    if (Array.isArray(value)) return value.map(record).filter((item): item is ApiRecord => Boolean(item));
  }
  return [];
}

function firstString(source: ApiRecord, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function date(source: ApiRecord, keys: string[]) {
  const value = firstString(source, keys);
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  return match;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function amount(item: ApiRecord) {
  const detail = record(item.detalhe_valor) ?? {};
  for (const value of [
    item.total,
    item.valor,
    item.valor_bruto,
    item.valor_original,
    detail.valor_bruto,
    detail.valor_liquido,
  ]) {
    const parsed = numberValue(value);
    if (parsed != null) return Math.abs(parsed);
  }
  return null;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string" && entry.trim()) return [entry.trim()];
    const item = record(entry);
    if (!item) return [];
    const name = firstString(item, ["nome", "descricao", "name"]);
    return name ? [name] : [];
  });
}

function categoryNames(item: ApiRecord) {
  const direct = names(item.categorias ?? item.categorias_rateio ?? item.rateio);
  const single = record(item.categoria);
  const singleName = single ? firstString(single, ["nome", "descricao", "name"]) : null;
  return Array.from(new Set([...direct, ...(singleName ? [singleName] : [])]));
}

function counterparty(item: ApiRecord) {
  const source = record(item.cliente) ?? record(item.contato) ?? {};
  return firstString(source, ["nome", "razao_social", "nome_fantasia", "name"])
    || firstString(item, ["nome_contato", "cliente", "contato"])
    || "";
}

function receivable(item: ApiRecord, fallbackId: string): ContaAzulReceivable | null {
  const value = amount(item);
  if (value == null) return null;
  return {
    id: firstString(item, ["id", "uuid", "id_evento", "id_parcela"]) || fallbackId,
    description: firstString(item, ["descricao", "nome", "observacao", "referencia"]) || "Sem descrição",
    counterparty: counterparty(item),
    categoryNames: categoryNames(item),
    competenceDate: date(item, ["data_competencia", "competencia"]),
    dueDate: date(item, ["data_vencimento", "vencimento"]),
    paymentDate: date(item, ["data_pagamento", "pagamento", "data_recebimento", "data_baixa", "data_ultimo_pagamento"]),
    amount: value,
    status: firstString(item, ["status_traduzido", "status", "situacao"]) || "NÃO INFORMADO",
  };
}

async function query(clientId: string, params: URLSearchParams, source: string) {
  const result: ContaAzulReceivable[] = [];
  const pageSize = 1000;
  for (let page = 1; page <= 25; page += 1) {
    params.set("pagina", String(page));
    params.set("tamanho_pagina", String(pageSize));
    const body = await contaAzulRequest<unknown>(
      clientId,
      `/v1/financeiro/eventos-financeiros/contas-a-receber/buscar?${params.toString()}`,
    );
    const items = apiItems(body);
    items.forEach((item, index) => {
      const parsed = receivable(item, `${source}-${page}-${index}`);
      if (parsed) result.push(parsed);
    });
    if (items.length < pageSize) break;
  }
  return result;
}

function inPeriod(value: string | null, start: string, end: string) {
  return Boolean(value && value >= start && value <= end);
}

export async function fetchContaAzulReceivables(clientId: string, start: string, end: string) {
  const sources: Array<{ key: string; params: URLSearchParams; optional: boolean }> = [
    {
      key: "due",
      params: new URLSearchParams({ data_vencimento_de: start, data_vencimento_ate: end }),
      optional: false,
    },
    {
      key: "competence",
      params: new URLSearchParams({ data_competencia_de: start, data_competencia_ate: end }),
      optional: true,
    },
    {
      key: "payment",
      params: new URLSearchParams({ data_pagamento_de: start, data_pagamento_ate: end }),
      optional: true,
    },
  ];
  const collected: ContaAzulReceivable[] = [];
  for (const source of sources) {
    try {
      collected.push(...await query(clientId, source.params, source.key));
    } catch (error) {
      if (!source.optional) throw error;
    }
  }
  const deduplicated = [...new Map(collected.map((item) => [item.id, item])).values()];
  return deduplicated.filter((item) => (
    inPeriod(item.paymentDate, start, end)
    || inPeriod(item.competenceDate, start, end)
    || inPeriod(item.dueDate, start, end)
  ));
}

export async function fetchContaAzulRevenueCategories(clientId: string) {
  const body = await contaAzulRequest<unknown>(clientId, "/v1/categorias?pagina=1&tamanho_pagina=1000");
  return apiItems(body).flatMap((item) => {
    const id = firstString(item, ["id", "uuid", "id_categoria"]);
    const label = firstString(item, ["nome", "descricao", "name"]);
    const type = firstString(item, ["tipo"])?.toUpperCase();
    if (!id || !label || (type && type !== "RECEITA")) return [];
    return [{ value: id, label }];
  }).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}
