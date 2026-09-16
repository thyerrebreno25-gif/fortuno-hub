import { areSimilarInvoiceMerchantFeatures, invoiceMerchantFeatures, normalizeInvoiceMerchant } from "../card-invoices/category-learning";

export type HistoryAllocation = {
  categoryId: string;
  category: string;
  costCenterId: string | null;
  costCenter: string | null;
};
export type HistoryRecord = { id: string; description: string; allocations: HistoryAllocation[] };
export type ExistingHistoryRule = { normalizedDescription: string; category: string };
export type HistoryCandidate = {
  key: string;
  description: string;
  count: number;
  options: HistoryAllocation[];
  status: "READY" | "CONFLICT" | "PRESERVED";
  reason: string | null;
};
export type CategoryHistoryPreview = {
  version: 1;
  revision: number;
  client: { id: string; name: string };
  account: { id: string; name: string };
  period: { start: string; end: string; basis: "vencimento" };
  createdAt: string;
  nextPage: number;
  total: number | null;
  complete: boolean;
  truncated: boolean;
  seenIds: string[];
  records: HistoryRecord[];
  skipped: number;
  candidates: HistoryCandidate[];
  savedAt?: string;
  savedCount?: number;
};
export type CategoryHistoryView = Omit<CategoryHistoryPreview, "records" | "seenIds"> & { processedCount: number; withoutClassificationCount: number };
export function publicHistoryPreview(preview: CategoryHistoryPreview): CategoryHistoryView {
  const view = Object.fromEntries(Object.entries(preview).filter(([key]) => key !== "records" && key !== "seenIds")) as Omit<CategoryHistoryPreview, "records" | "seenIds">;
  return { ...view, processedCount: preview.seenIds.length, withoutClassificationCount: preview.records.filter((row) => !row.allocations.length).length };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
export function historyItems(body: unknown): Record<string, unknown>[] {
  const object = record(body);
  const items = Array.isArray(body) ? body : object.itens ?? object.items ?? object.data;
  return Array.isArray(items) ? items.map(record) : [];
}
export function historyParcelId(item: Record<string, unknown>): string {
  return text(item.id_parcela) || text(item.id) || text(item.uuid);
}
function uniqueOptions(options: HistoryAllocation[]) {
  return [...new Map(options.map((option) => [option.categoryId, option])).values()];
}

export function extractHistoryRecord(
  item: Record<string, unknown>,
  detail: unknown,
  categories: Map<string, string>,
  costCenters: Map<string, string>,
): HistoryRecord | null {
  const body = record(detail);
  const parcel = Object.keys(record(body.data)).length ? record(body.data) : body;
  const event = record(parcel.evento);
  const description = text(parcel.descricao) || text(item.descricao);
  const normalized = normalizeInvoiceMerchant(description);
  const status = text(parcel.status || item.status).toUpperCase();
  // Uma fatura consolidada não informa qual compra recebeu cada categoria.
  if (!normalized || /^(?:FATURA\b|PAGAMENTO (?:TOTAL |DA |DE )?FATURA\b|SALDO ANTERIOR\b)/.test(normalized)
    || ["CANCELADO", "CANCELADA", "PERDIDO", "RENEGOCIADO"].includes(status)
    || (text(event.tipo) && text(event.tipo).toUpperCase() !== "DESPESA")) return null;
  const splits = Array.isArray(event.rateio) ? event.rateio : Array.isArray(parcel.rateio) ? parcel.rateio : [];
  // Não transformar um rateio parcialmente desconhecido em uma categoria única.
  if (!splits.length) return { id: historyParcelId(item), description, allocations: [] };
  const allocations: HistoryAllocation[] = [];
  for (const raw of splits) {
    const split = record(raw);
    const categoryId = text(split.id_categoria);
    const category = categories.get(categoryId);
    if (!category) return { id: historyParcelId(item), description, allocations: [] };
    const centers = Array.isArray(split.rateio_centro_custo) ? split.rateio_centro_custo.map(record) : [];
    const centerIds = [...new Set(centers.map((center) => text(center.id_centro_custo)).filter(Boolean))];
    const costCenterId = centerIds.length === 1 && costCenters.has(centerIds[0]) ? centerIds[0] : null;
    allocations.push({ categoryId, category, costCenterId, costCenter: costCenterId ? costCenters.get(costCenterId)! : null });
  }
  return { id: historyParcelId(item), description, allocations };
}

export function buildHistoryCandidates(records: HistoryRecord[], existing: ExistingHistoryRule[]): HistoryCandidate[] {
  const existingFeatures = existing.map((rule) => invoiceMerchantFeatures(rule.normalizedDescription));
  const groups = new Map<string, HistoryRecord[]>();
  for (const row of records) {
    const key = normalizeInvoiceMerchant(row.description);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const candidates: HistoryCandidate[] = [];
  for (const [key, rows] of groups) {
    const options = uniqueOptions(rows.flatMap((row) => row.allocations)).map((option) => {
      const occurrences = rows.flatMap((row) => row.allocations).filter((allocation) => allocation.categoryId === option.categoryId);
      const centers = new Set(occurrences.map((allocation) => allocation.costCenterId));
      return centers.size === 1 && rows.every((row) => row.allocations.length === 1)
        ? option : { ...option, costCenterId: null, costCenter: null };
    });
    if (!options.length) continue;
    const features = invoiceMerchantFeatures(key);
    const preserved = existingFeatures.some((rule) => areSimilarInvoiceMerchantFeatures(features, rule));
    const conflict = options.length > 1 || rows.some((row) => row.allocations.length !== 1);
    candidates.push({
      key, description: rows[0].description, count: rows.length, options,
      status: preserved ? "PRESERVED" : conflict ? "CONFLICT" : "READY",
      reason: preserved ? "Já existe aprendizado para esta descrição ou uma semelhante. A regra atual será preservada."
        : conflict ? "Há categorias diferentes, rateio ou ocorrências sem classificação. Escolha a categoria ou desmarque a regra." : null,
    });
  }
  const features = new Map(candidates.map((candidate) => [candidate.key, invoiceMerchantFeatures(candidate.key)]));
  for (const candidate of candidates) {
    if (candidate.status === "PRESERVED") continue;
    const collision = candidates.some((other) => other.key !== candidate.key
      && other.options.some((option) => candidate.options.some((own) => own.categoryId !== option.categoryId))
      && areSimilarInvoiceMerchantFeatures(features.get(candidate.key)!, features.get(other.key)!));
    if (collision) {
      candidate.status = "CONFLICT";
      candidate.reason = "Uma descrição semelhante possui outra categoria. Revise as regras para evitar aprendizado ambíguo.";
    }
  }
  return candidates.sort((a, b) => a.description.localeCompare(b.description, "pt-BR"));
}

export function validateHistoryPeriod(start: string, end: string) {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(start) || !valid(end)) throw new Error("Informe datas válidas no formato AAAA-MM-DD.");
  if (start > end) throw new Error("A data inicial não pode ser posterior à data final.");
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 92) throw new Error("Selecione até 93 dias por consulta de aprendizado.");
  return { start, end, basis: "vencimento" as const };
}

export const HISTORY_PAGE_SIZE = 10;
export const HISTORY_MAX_PAGES = 500;
export async function readHistoryPage(preview: CategoryHistoryPreview, dependencies: {
  loadPage: (page: number) => Promise<unknown>;
  loadDetail: (id: string) => Promise<unknown>;
  categories: Map<string, string>;
  costCenters: Map<string, string>;
  existing: ExistingHistoryRule[];
}): Promise<CategoryHistoryPreview> {
  if (preview.complete || preview.savedAt) return preview;
  const body = await dependencies.loadPage(preview.nextPage);
  const items = historyItems(body);
  if (items.length > HISTORY_PAGE_SIZE) throw new Error("O Conta Azul retornou uma página maior que o solicitado. Reduza o período e tente novamente.");
  const seen = new Set(preview.seenIds);
  const records = [...preview.records];
  let skipped = preview.skipped;
  let added = 0;
  for (const item of items) {
    const id = historyParcelId(item);
    if (!id) { skipped += 1; continue; }
    if (seen.has(id)) continue;
    // Chamadas sequenciais preservam o refresh token rotativo e limitam o lote.
    const detail = await dependencies.loadDetail(id);
    const account = record(record(detail).conta_financeira);
    const accountId = text(account.id) || text(item.id_conta_financeira);
    if (accountId && accountId !== preview.account.id) throw new Error("A API retornou um lançamento de outra conta. A consulta foi interrompida sem salvar regras.");
    const row = extractHistoryRecord(item, detail, dependencies.categories, dependencies.costCenters);
    seen.add(id);
    added += 1;
    if (row) records.push(row);
    else skipped += 1;
  }
  const totalValue = record(body).itens_totais;
  const total = typeof totalValue === "number" ? totalValue : preview.total;
  const complete = items.length < HISTORY_PAGE_SIZE || (total !== null && seen.size >= total);
  if (!complete && added === 0) throw new Error("A API repetiu a página do histórico. A consulta foi interrompida sem salvar regras.");
  const truncated = !complete && preview.nextPage >= HISTORY_MAX_PAGES;
  return { ...preview, revision: preview.revision + 1, nextPage: preview.nextPage + 1, total,
    complete: complete || truncated, truncated, seenIds: [...seen], records, skipped,
    candidates: complete || truncated ? buildHistoryCandidates(records, dependencies.existing) : [] };
}

export function publicHistoryMetadata(metadata: unknown): unknown {
  const object = record(metadata);
  const preview = object.categoryLearningPreview as CategoryHistoryPreview | undefined;
  return preview?.version === 1 ? { ...object, categoryLearningPreview: publicHistoryPreview(preview) } : metadata;
}

export type HistorySelection = { key: string; categoryId: string };
export function selectHistoryRules(preview: CategoryHistoryPreview, selections: HistorySelection[],
  existing: ExistingHistoryRule[], categories: Map<string, string>, costCenters: Map<string, string>) {
  if (!preview.complete || preview.truncated) throw new Error("Conclua a consulta completa antes de salvar. Se o limite foi atingido, reduza o período.");
  if (!selections.length || selections.length > preview.candidates.length) throw new Error("Selecione ao menos uma regra válida.");
  const keys = new Set<string>();
  const rules: Array<{ normalizedDescription: string; category: string; costCenter: string | null; categoryId: string }> = [];
  let preserved = 0;
  const existingFeatures = existing.map((rule) => invoiceMerchantFeatures(rule.normalizedDescription));
  for (const selection of selections) {
    if (keys.has(selection.key)) throw new Error("Há regras repetidas na seleção.");
    keys.add(selection.key);
    const candidate = preview.candidates.find((item) => item.key === selection.key);
    const option = candidate?.options.find((item) => item.categoryId === selection.categoryId);
    if (!candidate || !option || candidate.status === "PRESERVED") throw new Error("A seleção não pertence à prévia gerada pelo sistema.");
    const category = categories.get(option.categoryId);
    if (!category || category !== option.category) throw new Error("Uma categoria mudou no Conta Azul. Gere uma nova prévia.");
    const candidateFeatures = invoiceMerchantFeatures(candidate.key);
    if (existingFeatures.some((rule) => areSimilarInvoiceMerchantFeatures(candidateFeatures, rule))) { preserved += 1; continue; }
    const costCenter = option.costCenterId && costCenters.get(option.costCenterId) === option.costCenter ? option.costCenter : null;
    rules.push({ normalizedDescription: candidate.key, category, costCenter, categoryId: option.categoryId });
  }
  const features = new Map(rules.map((rule) => [rule.normalizedDescription, invoiceMerchantFeatures(rule.normalizedDescription)]));
  if (rules.some((rule, index) => rules.slice(index + 1).some((other) => rule.categoryId !== other.categoryId
    && areSimilarInvoiceMerchantFeatures(features.get(rule.normalizedDescription)!, features.get(other.normalizedDescription)!)))) {
    throw new Error("As regras selecionadas têm descrições semelhantes com categorias diferentes. Desmarque uma delas para não ensinar uma classificação ambígua.");
  }
  return { rules, preserved };
}

export function historyPreviewText(preview: CategoryHistoryPreview) {
  const ready = preview.candidates.filter((candidate) => candidate.status === "READY").length;
  const conflicts = preview.candidates.filter((candidate) => candidate.status === "CONFLICT").length;
  const preserved = preview.candidates.filter((candidate) => candidate.status === "PRESERVED").length;
  const summary = preview.complete ? `${ready} regra(s) pronta(s), ${conflicts} para revisão e ${preserved} preservada(s).`
    : "As classificações serão analisadas ao concluir o histórico.";
  const nextAction = preview.truncated ? "O limite da consulta foi atingido. Reduza o período e gere uma nova prévia."
    : preview.complete ? "Revise a prévia e confirme as regras que deseja aprender." : "Continue a consulta para revisar o histórico completo.";
  return `Aprendizado de faturas — ${preview.client.name}\nConta: ${preview.account.name}. Período por vencimento: ${preview.period.start} a ${preview.period.end}.\n${preview.seenIds.length} lançamento(s) consultado(s). ${summary}\n${nextAction} Nenhum lançamento no Conta Azul será alterado.`;
}
