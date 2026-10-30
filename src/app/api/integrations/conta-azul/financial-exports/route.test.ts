import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  member: vi.fn(), permission: vi.fn(), client: vi.fn(), request: vi.fn(),
  db: { documentImportDispatchLease: { upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn() }, contaAzulConnection: { findFirst: vi.fn() },
    contaAzulFinancialExport: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    contaAzulFinancialExportLine: { findMany: vi.fn(), update: vi.fn(), groupBy: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permission }));
vi.mock("@/modules/purchase-invoices/server/auth", () => ({ getPurchaseInvoiceMember: mocks.member, findAuthorizedClient: mocks.client }));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
vi.mock("server-only", () => ({}));
import { POST } from "./route";

const uuid = (number: number) => `${String(number).padStart(8, "0")}-1111-4111-8111-111111111111`;
const ACCOUNT_X = uuid(1), ACCOUNT_Y = uuid(2), CONTACT = uuid(3), CATEGORY = uuid(4);
type Status = "PENDING" | "CREATED" | "SETTLED" | "FAILED";
type MemoryLine = { id: string; lineKey: string; direction: "PAYABLE" | "RECEIVABLE"; description: string; amount: number;
  categoryName: string; costCenterName: string | null; metadata: unknown; competenceDate: Date; dueDate: Date; paymentDate: Date | null;
  createdAt: Date; updatedAt: Date; status: Status; externalProtocolId: string | null; externalEventId: string | null;
  externalInstallmentId: string | null; lastError: string | null };
type NewLine = Pick<MemoryLine, "lineKey" | "direction" | "description" | "amount" | "categoryName" | "costCenterName" | "metadata" | "competenceDate" | "dueDate" | "paymentDate">;
type Batch = { id: string; financialAccountId: string; settleRequested: boolean; contactId: string; metadata: unknown; lines: MemoryLine[] };
let batch: Batch | null;
let protocols: Map<string, string>;
let eventSequence: number;
function body(useLineAccounts = true, settle = false) {
  return { clientId: "client1", module: "CREDIT_CARD_INVOICE", sourceKey: "fatura-teste.pdf", sourceName: "fatura-teste.pdf",
    counterpartyHint: "Banco Teste", financialAccountId: ACCOUNT_X, financialAccountName: "Nome ignorado", useLineAccounts, settle,
    lines: [1, 2].map((index) => ({ lineKey: `compra-${index}`, direction: "PAYABLE", competenceDate: "2026-09-01", dueDate: "2026-09-10", paymentDate: "2026-09-10",
      description: `Compra ${index}`, amount: index * 10, categoryName: "Sistemas",
      ...(useLineAccounts ? { financialAccountId: index === 1 ? ACCOUNT_X : ACCOUNT_Y, financialAccountName: "Nome adulterado" } : {}),
    })),
  };
}
async function send(data: unknown) {
  return POST(new Request("http://localhost/api/integrations/conta-azul/financial-exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }));
}
function financialCreates() { return mocks.request.mock.calls.filter((call) => call[2]?.method === "POST" && /contas-a-(?:pagar|receber)$/.test(call[1])); }
function settlementCreates() { return mocks.request.mock.calls.filter((call) => call[2]?.method === "POST" && call[1].endsWith("/baixa")); }
beforeEach(() => {
  vi.resetAllMocks(); batch = null; protocols = new Map(); eventSequence = 10;
  mocks.db.documentImportDispatchLease.updateMany.mockResolvedValue({ count: 1 }); mocks.db.documentImportDispatchLease.findFirst.mockResolvedValue({});
  mocks.member.mockResolvedValue({ organizationId: "org1", userId: "user1", role: "OPERATOR" });
  mocks.permission.mockResolvedValue({ IMPORTS: { canExport: true }, PURCHASE_INVOICES: { canExport: true } });
  mocks.client.mockImplementation(async (_member, id: string) => ({ id, name: id === "client1" ? "Unidade 1" : "Unidade 2", document: id === "client1" ? "11111111000111" : "22222222000122" })); mocks.db.contaAzulConnection.findFirst.mockResolvedValue({ id: "connection1" });
  mocks.db.contaAzulFinancialExport.findUnique.mockImplementation(async () => batch);
  mocks.db.contaAzulFinancialExport.create.mockImplementation(async ({ data }) => {
    batch = { id: "export1", financialAccountId: data.financialAccountId, settleRequested: data.settleRequested, contactId: data.contactId, metadata: data.metadata,
      lines: data.lines.create.map((line: NewLine, index: number): MemoryLine => ({ ...line, id: `line${index + 1}`, status: "PENDING", createdAt: new Date(), updatedAt: new Date(),
        externalProtocolId: null, externalEventId: null, externalInstallmentId: null, lastError: null })),
    }; return batch;
  });
  mocks.db.contaAzulFinancialExportLine.findMany.mockImplementation(async ({ where }) => batch?.lines.filter((line) => where.status ? line.status === where.status : where.OR.some((condition: Record<string, unknown>) => line.status === condition.status && ["externalProtocolId", "externalEventId", "externalInstallmentId"].every((key) => condition[key] === undefined || condition[key] === null ? condition[key] === undefined || !(line as unknown as Record<string, unknown>)[key] : Boolean((line as unknown as Record<string, unknown>)[key])))) || []);
  mocks.db.contaAzulFinancialExportLine.update.mockImplementation(async ({ where, data }) => { const line = batch!.lines.find((item) => item.id === where.id)!; Object.assign(line, data); return line; });
  mocks.db.contaAzulFinancialExportLine.groupBy.mockImplementation(async () => [...new Set(batch!.lines.map((line) => line.status))].map((status) => ({ status, _count: { _all: batch!.lines.filter((line) => line.status === status).length } })));
  mocks.db.contaAzulFinancialExportLine.findFirst.mockImplementation(async () => batch?.lines.find((line) => line.status === "FAILED") || null);
  mocks.request.mockImplementation(async (_client, path: string, options?: { method?: string; body?: string }) => {
    if (path.startsWith("/v1/conta-financeira?")) return { itens: [{ id: ACCOUNT_X, nome: "Conta X", ativo: true }, { id: ACCOUNT_Y, nome: "Conta Y", ativo: true }] };
    if (path.startsWith("/v1/pessoas?")) return { itens: [{ id: CONTACT, nome: new URL(`http://local${path}`).searchParams.get("busca") }] };
    if (path.startsWith("/v1/pessoas/")) return { id: CONTACT, perfis: ["Fornecedor", "Cliente"] };
    if (path.startsWith("/v1/categorias?")) return { itens: [{ id: CATEGORY, nome: "Sistemas", tipo: "DESPESA" }, { id: uuid(5), nome: "Reembolsos", tipo: "RECEITA" }] };
    if (path.startsWith("/v1/centro-de-custo?")) return { itens: [] };
    if (options?.method === "POST" && /contas-a-(?:pagar|receber)$/.test(path)) {
      const id = uuid(eventSequence++); return { id, condicao_pagamento: { parcelas: [{ id: uuid(100 + Number(id.slice(0, 8))) }] } };
    }
    if (path.startsWith("/v1/protocolo/")) return { status: "SUCCESS", resourceId: protocols.get(path.split("/").at(-1)!) };
    if (path.endsWith("/parcelas")) return { itens: [{ id: uuid(100 + Number(path.split("/").at(-2)?.slice(0, 8))) }] };
    if (path.endsWith("/baixa")) return options?.method === "POST" ? { id: uuid(999) } : { itens: [] };
    if (path.includes("/parcelas/")) {
      const installmentId = path.split("/").at(-1)!;
      const line = batch!.lines.find((line) => line.externalInstallmentId === installmentId || line.externalEventId && installmentId === uuid(100 + Number(line.externalEventId.slice(0, 8)))) || batch!.lines[1];
      const metadata = line.metadata as Record<string, unknown>;
      return { id: installmentId, descricao: line.description, nota: metadata.creationReference || "", data_vencimento: line.dueDate.toISOString().slice(0, 10), valor_liquido: line.amount, conta_financeira: { id: metadata.financialAccountId || batch!.financialAccountId }, evento: { id: line.externalEventId, tipo: line.direction === "RECEIVABLE" ? "RECEITA" : "DESPESA", data_competencia: line.competenceDate.toISOString().slice(0, 10), rateio: [{ id_categoria: (line as MemoryLine & { contaAzulCategoryId: string }).contaAzulCategoryId, valor: line.amount }] } };
    }
    throw new Error(`Endpoint inesperado no teste: ${path}`);
  });
});

const ACCOUNT_Z = uuid(6), CONTACT_2 = uuid(7), CATEGORY_2 = uuid(8), CENTER_2 = uuid(9);
function multiClientBody(settle = true) {
  const data = body(true, settle);
  return { ...data, lines: data.lines.map((line, index) => ({ ...line,
    costCenterName: undefined as string | undefined,
    destinationClientId: index === 0 ? "client1" : "client2", destinationClientName: "Nome adulterado",
    financialAccountId: index === 0 ? ACCOUNT_X : ACCOUNT_Z,
  })) };
}
function setupTwoClients() {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => {
    const [clientId, path] = args;
    if (clientId === "client2") {
      if (path.startsWith("/v1/conta-financeira?")) return { itens: [{ id: ACCOUNT_Z, nome: "Cartão Unidade 2", ativo: true }] };
      if (path.startsWith("/v1/categorias?")) return { itens: [{ id: CATEGORY_2, nome: "Sistemas", tipo: "DESPESA" }, { id: uuid(15), nome: "Reembolsos", tipo: "RECEITA" }] };
      if (path.startsWith("/v1/centro-de-custo?")) return { itens: [{ id: CENTER_2, nome: "Operação 2" }] };
      if (path.startsWith("/v1/pessoas?")) return { itens: [{ id: CONTACT_2, nome: new URL(`http://local${path}`).searchParams.get("busca") }] };
      if (path.startsWith("/v1/pessoas/")) return { id: CONTACT_2, perfis: ["Fornecedor", "Cliente"] };
    }
    return original(...args);
  });
}

describe("rateio da mesma fatura entre cadastros/CNPJs", () => {
  beforeEach(setupTwoClients);
  it("cria e baixa em cada integração, com categorias, contatos e contas próprios", async () => {
    const data = multiClientBody(); const response = await send(data);
    expect(response.status).toBe(200); expect((await response.json()).done).toBe(true);
    expect(financialCreates().map((call) => call[0])).toEqual(["client1", "client2"]);
    expect(financialCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_Z]);
    expect(financialCreates().map((call) => JSON.parse(call[2].body).rateio[0].id_categoria)).toEqual([CATEGORY, CATEGORY_2]);
    expect(financialCreates().map((call) => JSON.parse(call[2].body).id_fornecedor)).toEqual([CONTACT, CONTACT_2]);
    expect(settlementCreates().map((call) => [call[0], JSON.parse(call[2].body).conta_financeira])).toEqual([["client1", ACCOUNT_X], ["client2", ACCOUNT_Z]]);
    expect(mocks.request.mock.calls.filter((call) => call[1].startsWith("/v1/protocolo/"))).toHaveLength(0);
    expect(mocks.request.mock.calls.filter((call) => call[1].includes("/parcelas/") && !call[1].endsWith("/baixa")).map((call) => call[0])).toEqual(["client1", "client2"]);
    expect(batch!.lines.map((line) => line.metadata)).toMatchObject([{ destinationClientId: "client1", destinationClientName: "Unidade 1" }, { destinationClientId: "client2", destinationClientName: "Unidade 2" }]);
    expect(mocks.db.contaAzulFinancialExport.create.mock.calls[0][0].data.clientId).toBe("client1");
  });
  it("aceita o primeiro lançamento em outro CNPJ sem usar a conta no cliente de origem", async () => {
    const data = multiClientBody(false); data.lines.reverse(); data.financialAccountId = ACCOUNT_Z;
    expect((await (await send(data)).json()).done).toBe(true);
    expect(financialCreates().map((call) => call[0])).toEqual(["client2", "client1"]);
  });
  it("valida autorização e conexão de todos os destinos antes de acessar qualquer API", async () => {
    const originalClient = mocks.client.getMockImplementation()!;
    mocks.client.mockImplementation(async (...args) => args[1] === "client2" ? null : originalClient(...args));
    expect((await send(multiClientBody())).status).toBe(404); expect(mocks.request).not.toHaveBeenCalled(); expect(batch).toBeNull();
    mocks.client.mockImplementation(originalClient);
    mocks.db.contaAzulConnection.findFirst.mockImplementation(async ({ where }) => where.clientId === "client2" ? null : { id: "connection1" });
    expect((await send(multiClientBody())).status).toBe(400); expect(mocks.request).not.toHaveBeenCalled(); expect(batch).toBeNull();
  });
  it("rejeita conta de outra unidade, mesmo que seja válida no cliente de origem", async () => {
    const data = multiClientBody(); data.lines[1].financialAccountId = ACCOUNT_X;
    expect((await send(data)).status).toBe(400); expect(batch).toBeNull();
    expect(mocks.request.mock.calls.every((call) => call[1].startsWith("/v1/conta-financeira?"))).toBe(true);
  });
  it("não inicia o envio se uma classificação não existir no destino", async () => {
    const data = multiClientBody(); data.lines[1].categoryName = "Categoria só na origem";
    const response = await send(data); expect(response.status).toBe(400);
    expect((await response.json()).unresolvedCategories).toContain("Unidade 2: Categoria só na origem");
    expect(financialCreates()).toHaveLength(0); expect(batch).toBeNull();
    expect(mocks.request.mock.calls.every((call) => call[2]?.method !== "POST")).toBe(true);
  });
  it("centro de custo e crédito seguem o catálogo e a integração de destino", async () => {
    const data = multiClientBody(); data.lines[1] = { ...data.lines[1], direction: "RECEIVABLE", categoryName: "Reembolsos", costCenterName: "Operação 2" };
    expect((await (await send(data)).json()).done).toBe(true);
    const credit = financialCreates()[1]; expect(credit[0]).toBe("client2"); expect(credit[1]).toContain("contas-a-receber");
    expect(JSON.parse(credit[2].body).rateio[0]).toMatchObject({ id_categoria: uuid(15), rateio_centro_custo: [{ id_centro_custo: CENTER_2, valor: 20 }] });
  });
  it("retoma falha de uma unidade sem recriar ou baixar novamente os itens concluídos da outra", async () => {
    const original = mocks.request.getMockImplementation()!; let fail = true;
    mocks.request.mockImplementation(async (...args) => {
      if (fail && args[0] === "client2" && args[2]?.method === "POST" && args[1].endsWith("/contas-a-pagar")) { fail = false; throw Object.assign(new Error("Rejeição de validação da unidade 2"), { status: 400 }); }
      return original(...args);
    });
    const first = await (await send(multiClientBody())).json(); expect(first.done).toBe(false); expect(first.counts).toMatchObject({ SETTLED: 1, FAILED: 1 });
    expect((await (await send(multiClientBody())).json()).done).toBe(true);
    expect(financialCreates().filter((call) => call[0] === "client1")).toHaveLength(1);
    expect(financialCreates().filter((call) => call[0] === "client2")).toHaveLength(2);
    expect(settlementCreates().map((call) => call[0])).toEqual(["client1", "client2"]);
    expect(mocks.db.contaAzulFinancialExport.create).toHaveBeenCalledTimes(1);
  });
  it("trocar o cadastro na retomada é bloqueado antes de chamadas externas", async () => {
    await send(multiClientBody()); const count = mocks.request.mock.calls.length;
    const data = multiClientBody(); data.lines[1].destinationClientId = "client1";
    expect((await send(data)).status).toBe(409); expect(mocks.request).toHaveBeenCalledTimes(count);
    expect(financialCreates()).toHaveLength(2);
  });
  it("rateios antigos sem cadastro persistido continuam no cliente de origem", async () => {
    await send(body()); batch!.lines.forEach((line) => { delete (line.metadata as Record<string, unknown>).destinationClientId; });
    expect((await send(body())).status).toBe(200); expect(financialCreates()).toHaveLength(2);
  });
  it("não permite cadastrar destino com rateio desligado nem chaves de linha duplicadas", async () => {
    const data = multiClientBody(); expect((await send({ ...data, useLineAccounts: false })).status).toBe(400);
    data.lines[1].lineKey = data.lines[0].lineKey; expect((await send(data)).status).toBe(400); expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("envio de fatura com conta por lançamento", () => {
  it("aceita o retorno síncrono novo sem consultar protocolo", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args) => {
      const path: string = args[1];
      if (args[2]?.method === "POST" && path === "/v1/financeiro/contas-a-pagar") {
        const eventId = uuid(700 + eventSequence++);
        return {
          id: eventId,
          condicao_pagamento: { parcelas: [{ id: uuid(800 + eventSequence) }] },
        };
      }
      return original(...args);
    });
    const response = await send(body(true, true));
    expect((await response.json()).done).toBe(true);
    expect(mocks.request.mock.calls.filter((call) => call[1].startsWith("/v1/protocolo/"))).toHaveLength(0);
    expect(batch!.lines.every((line) => Boolean(line.externalEventId && line.externalInstallmentId))).toBe(true);
    expect(batch!.lines.map((line) => line.status)).toEqual(["SETTLED", "SETTLED"]);
  });

  it("usa o banco da fatura como fornecedor das despesas", async () => {
    const result = await send(body(false)); expect(result.status).toBe(200); expect((await result.json()).done).toBe(true);
    const personSearch = mocks.request.mock.calls.find((call) => call[1].startsWith("/v1/pessoas?"));
    expect(new URL(`http://local${personSearch?.[1]}`).searchParams.get("busca")).toBe("Banco Teste");
    expect(financialCreates().map((call) => JSON.parse(call[2].body).id_fornecedor)).toEqual([CONTACT, CONTACT]);
  });

  it("cria cada despesa na conta correta e persiste o rateio com os nomes reais do cliente", async () => {
    const result = await send(body()); expect(result.status).toBe(200); expect((await result.json()).done).toBe(true);
    expect(financialCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_Y]);
    expect(financialCreates().map((call) => JSON.parse(call[2].body).condicao_pagamento.parcelas[0].conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_Y]);
    expect(batch!.lines.map((line) => line.metadata)).toMatchObject([{ financialAccountId: ACCOUNT_X, financialAccountName: "Conta X" }, { financialAccountId: ACCOUNT_Y, financialAccountName: "Conta Y" }]);
    expect(settlementCreates()).toHaveLength(0);
  });
  it("a baixa segue a mesma conta persistida de cada despesa", async () => {
    const result = await send(body(true, true)); expect((await result.json()).done).toBe(true);
    expect(settlementCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_Y]);
    expect(batch!.lines.map((line) => line.status)).toEqual(["SETTLED", "SETTLED"]);
  });
  it("créditos/estornos também respeitam sua conta na criação e na baixa", async () => {
    const data = body(true, true); data.lines[1].direction = "RECEIVABLE"; data.lines[1].categoryName = "Reembolsos";
    expect((await (await send(data)).json()).done).toBe(true);
    expect(financialCreates().map((call) => call[1].split("/").at(-1))).toEqual(["contas-a-pagar", "contas-a-receber"]);
    expect(settlementCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_Y]);
  });
  it("busca de parcela na retomada fica restrita à conta de destino da linha", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args) => {
      const path: string = args[1];
      if (args[2]?.method === "POST" && /contas-a-pagar$/.test(path)) { const result = await original(...args); return { id: result.id }; }
      if (path.endsWith(`/${uuid(11)}/parcelas`)) return { itens: [] };
      if (path.includes("/contas-a-pagar/buscar?")) {
        expect(new URL(`http://local${path}`).searchParams.get("ids_contas_financeiras")).toBe(ACCOUNT_Y);
        return { itens: [{ id: uuid(650), descricao: "Compra 2" }] };
      }
      return original(...args);
    });
    const response = await send(body(true, true)); expect((await response.json()).done).toBe(true);
    expect(mocks.request.mock.calls.some((call) => call[1].includes("ids_contas_financeiras="))).toBe(true);
    expect(settlementCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_Y]);
  });
  it("não ignora conta faltante nem usa a conta global silenciosamente", async () => {
    const data = body(); delete data.lines[1].financialAccountId;
    expect((await send(data)).status).toBe(400); expect(mocks.request).not.toHaveBeenCalled(); expect(batch).toBeNull();
  });
  it("rejeita conta do lote incompatível com a primeira conta do rateio", async () => {
    const data = body(); data.financialAccountId = ACCOUNT_Y;
    expect((await send(data)).status).toBe(400); expect(batch).toBeNull(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejeita conta de outro cliente ou inativa antes de preparar contatos ou gravar lote", async () => {
    const data = body(); data.lines[1].financialAccountId = uuid(987);
    expect((await send(data)).status).toBe(400); expect(batch).toBeNull(); expect(financialCreates()).toHaveLength(0);
    expect(mocks.request.mock.calls.every((call) => call[1].startsWith("/v1/conta-financeira?"))).toBe(true);
    mocks.request.mockResolvedValue({ itens: [{ id: ACCOUNT_X, nome: "Conta X", ativo: true }, { id: ACCOUNT_Y, nome: "Conta Y", ativo: false }] });
    expect((await send(body())).status).toBe(400); expect(batch).toBeNull();
  });
  it("repete requisição e continua lotes sem duplicar despesas", async () => {
    await send(body()); const original = batch;
    await send(body()); expect(batch).toBe(original); expect(financialCreates()).toHaveLength(2); expect(mocks.db.contaAzulFinancialExport.create).toHaveBeenCalledTimes(1);
  });
  it("retomada rejeita mudança na conta da segunda linha, mesmo mantendo conta global e lineKey", async () => {
    await send(body()); const data = body(); data.lines[1].financialAccountId = ACCOUNT_X;
    const result = await send(data); expect(result.status).toBe(409); expect((await result.json()).error).toContain("rateio");
    expect(financialCreates()).toHaveLength(2);
  });
  it("não permite ativar/desativar rateio em lote já iniciado", async () => {
    await send(body()); expect((await send(body(false))).status).toBe(409); expect(financialCreates()).toHaveLength(2);
  });
  it("sem flag continua enviando todas as linhas para a conta única e suporta metadados antigos", async () => {
    await send(body(false));
    expect(financialCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_X]);
    batch!.metadata = {};
    expect((await send(body(false))).status).toBe(200); expect(financialCreates()).toHaveLength(2);
  });
  it("adquirentes continuam usando uma conta única e não aceitam ativar esta flag", async () => {
    expect((await send({ ...body(), module: "ACQUIRER" })).status).toBe(400);
    expect((await send({ ...body(false), module: "ACQUIRER" })).status).toBe(200);
    expect(financialCreates().map((call) => JSON.parse(call[2].body).conta_financeira)).toEqual([ACCOUNT_X, ACCOUNT_X]);
    const personSearch = mocks.request.mock.calls.find((call) => call[1].startsWith("/v1/pessoas?"));
    expect(new URL(`http://local${personSearch?.[1]}`).searchParams.get("busca")).toBe("Banco Teste");
  });
  it("não envia sem autenticação, permissão, cliente ou conexão", async () => {
    mocks.member.mockResolvedValueOnce(null); expect((await send(body())).status).toBe(401);
    mocks.permission.mockResolvedValueOnce({ IMPORTS: { canExport: false }, PURCHASE_INVOICES: { canExport: false } }); expect((await send(body())).status).toBe(403);
    mocks.client.mockResolvedValueOnce(null); expect((await send(body())).status).toBe(404);
    mocks.db.contaAzulConnection.findFirst.mockResolvedValueOnce(null); expect((await send(body())).status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled(); expect(batch).toBeNull();
  });
  it("lineKeys não passam a incluir a conta: mudar destino não pode criar outro lote", async () => {
    await send(body()); expect(batch!.lines[0].lineKey).toBe(crypto.createHash("sha256").update("compra-1").digest("hex"));
    expect(mocks.db.contaAzulFinancialExport.create.mock.calls[0][0].data.sourceKey).toBe(crypto.createHash("sha256").update("CREDIT_CARD_INVOICE|fatura-teste.pdf").digest("hex"));
  });
});

describe("confirmação real no CA e proteção contra reenvio", () => {
  it("não conclui quando o CA devolve ID mas a parcela não existe", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args) => { if (args[1].includes("/parcelas/") && !args[1].endsWith("/baixa")) throw Object.assign(new Error("Parcela não encontrada"), { status: 404 }); return original(...args); });
    expect((await (await send(body())).json()).done).toBe(false);
    expect(batch!.lines.every((line) => line.status === "FAILED")).toBe(true);
    await send(body()); expect(financialCreates()).toHaveLength(2); expect(settlementCreates()).toHaveLength(0);
  });
  it("não repete um POST com resultado incerto mesmo sem localizar a parcela", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args) => {
      if (args[2]?.method === "POST" && /contas-a-pagar$/.test(args[1])) throw new TypeError("timeout");
      if (args[1].includes("/buscar?")) return { itens: [] };
      return original(...args);
    });
    expect((await (await send(body())).json()).done).toBe(false);
    await send(body()); expect(financialCreates()).toHaveLength(2);
    expect(batch!.lines.every((line) => line.status === "FAILED")).toBe(true);
  }, 15000);
  it("não repete baixa com resultado incerto", async () => {
    const original = mocks.request.getMockImplementation()!;
    mocks.request.mockImplementation(async (...args) => { if (args[1].endsWith("/baixa") && args[2]?.method === "POST") throw new TypeError("timeout"); return original(...args); });
    expect((await (await send(body(true, true))).json()).done).toBe(false);
    await send(body(true, true)); expect(settlementCreates()).toHaveLength(2); expect(financialCreates()).toHaveLength(2);
  });
  it("bloqueia envio concorrente da mesma empresa antes de chamadas ao CA", async () => {
    mocks.db.documentImportDispatchLease.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await send(body())).status).toBe(409); expect(mocks.request).not.toHaveBeenCalled();
  });
});

it("rejeita baixa futura antes de qualquer lançamento no CA", async () => { const data = body(true, true); data.lines[0].paymentDate = "2199-01-01"; expect((await send(data)).status).toBe(400); expect(mocks.request).not.toHaveBeenCalled(); });
it("não troca silenciosamente valor ou categoria de um envio existente", async () => { await send(body()); const data = body(); data.lines[0].amount = 999; expect((await send(data)).status).toBe(409); expect(financialCreates()).toHaveLength(2); });

it("retoma a partir dos dados salvos sem exigir novo upload nem recriar itens concluídos", async () => {
  await send(body()); mocks.db.contaAzulFinancialExport.findFirst.mockResolvedValue({ ...batch!, clientId: "client1", module: "CREDIT_CARD_INVOICE", sourceName: "fatura-teste.pdf", contactName: "Banco Teste" });
  const result = await send({ resumeExportId: "export1", confirmation: "ENVIAR AO CA" }); expect(result.status).toBe(200); expect((await result.json()).done).toBe(true); expect(financialCreates()).toHaveLength(2);
});
