import { describe, expect, it, vi } from "vitest";
import { buildHistoryCandidates, extractHistoryRecord, HISTORY_MAX_PAGES, HISTORY_PAGE_SIZE, publicHistoryMetadata,
  readHistoryPage, selectHistoryRules, validateHistoryPeriod, type CategoryHistoryPreview, type HistoryRecord } from "./category-history";

const categories = new Map([["systems", "Sistemas"], ["marketing", "Marketing"], ["travel", "Viagens"]]);
const centers = new Map([["admin", "Administrativo"], ["commercial", "Comercial"]]);
function row(description = "OPEN AI CHATGPT USD 20,00", categoryId = "systems", id = "p1"): HistoryRecord {
  return { id, description, allocations: [{ categoryId, category: categories.get(categoryId)!, costCenterId: "admin", costCenter: "Administrativo" }] };
}
function preview(records = [row()]): CategoryHistoryPreview {
  return { version: 1, revision: 1, client: { id: "client1", name: "Cliente 1" }, account: { id: "card1", name: "Bradesco" },
    period: { start: "2026-08-01", end: "2026-08-31", basis: "vencimento" }, createdAt: "2026-09-16T12:00:00Z",
    nextPage: 1, total: null, complete: true, truncated: false, seenIds: records.map((item) => item.id), records,
    skipped: 0, candidates: buildHistoryCandidates(records, []) };
}
function detail(categoryIds = ["systems"], description = "OPENAI CHATGPT") {
  return { descricao: description, evento: { tipo: "DESPESA", rateio: categoryIds.map((id_categoria) => ({
    id_categoria, nome_categoria: "Nome não confiável do histórico", rateio_centro_custo: [{ id_centro_custo: "admin" }],
  })) } };
}

describe("extração de categorias reais do Conta Azul", () => {
  it("consulta categoria e centro pelo ID e usa os nomes atuais do catálogo", () => {
    expect(extractHistoryRecord({ id: "p1" }, detail(), categories, centers)).toEqual(row("OPENAI CHATGPT"));
  });
  it("aceita resposta encapsulada em data e usa a descrição da listagem se necessário", () => {
    expect(extractHistoryRecord({ id: "p1", descricao: "ADOBE" }, { data: detail(["systems"], "") }, categories, centers)?.description).toBe("ADOBE");
  });
  it("não inventa uma categoria com base na descrição quando falta rateio", () => {
    expect(extractHistoryRecord({ id: "p1", descricao: "OPENAI" }, {}, categories, centers)?.allocations).toEqual([]);
  });
  it("não aceita nomes de categorias antigas ou IDs fora do catálogo", () => {
    expect(extractHistoryRecord({ id: "p1" }, detail(["systems", "unknown"]), categories, centers)?.allocations).toEqual([]);
  });
  it.each(["Fatura Bradesco", "Pagamento da fatura", "Saldo anterior"])("ignora lançamento consolidado %s", (description) => {
    expect(extractHistoryRecord({ id: "p1" }, detail(["systems"], description), categories, centers)).toBeNull();
  });
  it("ignora cancelados e eventos de receita", () => {
    expect(extractHistoryRecord({ id: "p1", status: "CANCELADO" }, detail(), categories, centers)).toBeNull();
    const body = detail(); body.evento.tipo = "RECEITA";
    expect(extractHistoryRecord({ id: "p1" }, body, categories, centers)).toBeNull();
  });
  it("não aprende centro de custo quando o rateio tem múltiplos centros", () => {
    const body = detail(); body.evento.rateio[0].rateio_centro_custo.push({ id_centro_custo: "commercial" });
    expect(extractHistoryRecord({ id: "p1" }, body, categories, centers)?.allocations[0].costCenter).toBeNull();
  });
});

describe("prévia e confirmação segura", () => {
  it("agrupa OpenAI mesmo quando o valor muda", () => {
    const candidates = buildHistoryCandidates([row(), row("OPENAI CHATGPT USD 200,00", "systems", "p2")], []);
    expect(candidates).toHaveLength(1); expect(candidates[0].count).toBe(2); expect(candidates[0].status).toBe("READY");
  });
  it("deixa categorias conflitantes para revisão sem escolher a mais frequente", () => {
    const candidates = buildHistoryCandidates([row(), row("OPENAI CHATGPT USD 200,00", "marketing", "p2")], []);
    expect(candidates[0].status).toBe("CONFLICT"); expect(candidates[0].options).toHaveLength(2);
  });
  it("requer revisão quando há rateio e quando uma ocorrência está sem categoria", () => {
    const records = [row()]; records[0].allocations.push(row("", "marketing").allocations[0]);
    expect(buildHistoryCandidates(records, [])[0].status).toBe("CONFLICT");
    expect(buildHistoryCandidates([row(), { id: "p2", description: "OPENAI CHATGPT", allocations: [] }], [])[0].status).toBe("CONFLICT");
  });
  it("omite centros de custo inconsistentes entre meses/ocorrências", () => {
    const other = row("OPENAI CHATGPT", "systems", "p2"); other.allocations[0].costCenterId = null; other.allocations[0].costCenter = null;
    expect(buildHistoryCandidates([row(), other], [])[0].options[0].costCenter).toBeNull();
  });
  it("preserva regras existentes até para descrições semelhantes", () => {
    expect(buildHistoryCandidates([row()], [{ normalizedDescription: "OPENAI CHATGPT BR", category: "Marketing" }])[0].status).toBe("PRESERVED");
  });
  it("preserva regras criadas depois da prévia e não as sobrescreve", () => {
    const view = preview();
    const result = selectHistoryRules(view, [{ key: view.candidates[0].key, categoryId: "systems" }],
      [{ normalizedDescription: "OPENAI CHATGPT", category: "Marketing" }], categories, centers);
    expect(result.rules).toHaveLength(0); expect(result.preserved).toBe(1);
  });
  it("não mistura Amazon Prime BR e Amazon Prime Videos", () => {
    const view = preview([row("AMAZON PRIME BR"), row("AMAZON PRIME VIDEOS", "marketing", "p2")]);
    expect(view.candidates).toHaveLength(2);
    expect(view.candidates[0].options[0].categoryId).not.toBe(view.candidates[1].options[0].categoryId);
    expect(view.candidates.every((candidate) => candidate.status === "CONFLICT")).toBe(true);
  });
  it("sinaliza e recusa aprender simultaneamente descrições semelhantes com categorias diferentes", () => {
    const view = preview([row("OPENAI CHATGPT"), row("OPENAI CHATGPT BR", "marketing", "p2")]);
    expect(view.candidates.every((candidate) => candidate.status === "CONFLICT")).toBe(true);
    expect(() => selectHistoryRules(view, view.candidates.map((candidate) => ({ key: candidate.key, categoryId: candidate.options[0].categoryId })), [], categories, centers)).toThrow("ambígua");
  });
  it("salva só as opções escolhidas que realmente apareceram na prévia", () => {
    const view = preview([row(), row("OPENAI CHATGPT", "marketing", "p2")]);
    const result = selectHistoryRules(view, [{ key: view.candidates[0].key, categoryId: "marketing" }], [], categories, centers);
    expect(result.rules[0].category).toBe("Marketing");
    expect(() => selectHistoryRules(view, [{ key: view.candidates[0].key, categoryId: "travel" }], [], categories, centers)).toThrow("prévia");
    expect(() => selectHistoryRules(view, [{ key: "FORGED", categoryId: "systems" }], [], categories, centers)).toThrow("prévia");
  });
  it("rejeita seleção repetida, categoria renomeada e prévia incompleta", () => {
    const view = preview(); const selection = { key: view.candidates[0].key, categoryId: "systems" };
    expect(() => selectHistoryRules(view, [selection, selection], [], categories, centers)).toThrow();
    expect(() => selectHistoryRules(view, [selection], [], new Map([["systems", "Alterada"]]), centers)).toThrow("mudou");
    expect(() => selectHistoryRules({ ...view, complete: false }, [selection], [], categories, centers)).toThrow("completa");
    expect(() => selectHistoryRules({ ...view, truncated: true }, [selection], [], categories, centers)).toThrow("completa");
  });
  it("não aprende um centro que saiu do catálogo", () => {
    const view = preview();
    expect(selectHistoryRules(view, [{ key: view.candidates[0].key, categoryId: "systems" }], [], categories, new Map()).rules[0].costCenter).toBeNull();
  });
  it("não envia histórico completo nem IDs de parcelas na metadata pública", () => {
    const metadata = publicHistoryMetadata({ categoryLearningPreview: preview(), extra: "ok" }) as { categoryLearningPreview: Record<string, unknown>; extra: string };
    expect(metadata.categoryLearningPreview.records).toBeUndefined(); expect(metadata.categoryLearningPreview.seenIds).toBeUndefined();
    expect(metadata.categoryLearningPreview.processedCount).toBe(1); expect(metadata.extra).toBe("ok");
  });
});

describe("histórico em lotes retomáveis", () => {
  const dependencies = () => ({ categories, costCenters: centers, existing: [],
    loadDetail: vi.fn(async () => detail()), loadPage: vi.fn(async () => ({ itens_totais: HISTORY_PAGE_SIZE + 1,
      itens: Array.from({ length: HISTORY_PAGE_SIZE }, (_, index) => ({ id: `p${index}` })) })) });
  it("consulta todos os lotes, informa progresso e evita duplicação entre páginas", async () => {
    const deps = dependencies();
    const first = await readHistoryPage({ ...preview([]), complete: false }, deps);
    expect(first.complete).toBe(false); expect(first.nextPage).toBe(2); expect(first.seenIds).toHaveLength(HISTORY_PAGE_SIZE);
    const second = await readHistoryPage(first, { ...deps, loadPage: async () => ({ itens_totais: HISTORY_PAGE_SIZE + 1, itens: [{ id: "p0" }, { id: "last" }] }) });
    expect(second.complete).toBe(true); expect(second.records).toHaveLength(HISTORY_PAGE_SIZE + 1);
    expect(deps.loadDetail).toHaveBeenCalledTimes(HISTORY_PAGE_SIZE + 1);
  });
  it("uma falha não modifica a prévia anterior e permite refazer o lote", async () => {
    const before = { ...preview([]), complete: false }; const deps = dependencies();
    deps.loadDetail.mockRejectedValueOnce(new Error("API indisponível"));
    await expect(readHistoryPage(before, deps)).rejects.toThrow("indisponível");
    expect(before.seenIds).toEqual([]); expect(before.records).toEqual([]); expect(before.nextPage).toBe(1);
    expect((await readHistoryPage(before, deps)).records).toHaveLength(HISTORY_PAGE_SIZE);
  });
  it("interrompe uma API que ignora a página e repete o mesmo lote", async () => {
    const deps = dependencies(); const first = await readHistoryPage({ ...preview([]), complete: false }, deps);
    await expect(readHistoryPage(first, deps)).rejects.toThrow("repetiu");
  });
  it("recusa um lançamento comprovadamente de outra conta", async () => {
    const deps = dependencies();
    await expect(readHistoryPage({ ...preview([]), complete: false }, { ...deps, loadDetail: async () => ({ ...detail(), conta_financeira: { id: "other-client-account" } }) })).rejects.toThrow("outra conta");
  });
  it("sinaliza o limite em vez de apresentar um histórico parcial como completo", async () => {
    const result = await readHistoryPage({ ...preview([]), complete: false, nextPage: HISTORY_MAX_PAGES }, dependencies());
    expect(result.truncated).toBe(true);
  });
  it("não faz chamadas externas para prévias finalizadas", async () => {
    const deps = dependencies(); await readHistoryPage(preview(), deps); expect(deps.loadPage).not.toHaveBeenCalled();
  });
});

describe("validação do período", () => {
  it.each([["2026-02-30", "2026-03-01"], ["not-a-date", "2026-03-01"], ["2026-09-01", "2026-08-31"], ["2026-01-01", "2026-12-31"]])("recusa %s a %s", (start, end) => {
    expect(() => validateHistoryPeriod(start, end)).toThrow();
  });
  it("informa claramente que a base é vencimento", () => {
    expect(validateHistoryPeriod("2026-08-01", "2026-08-31").basis).toBe("vencimento");
  });
});
