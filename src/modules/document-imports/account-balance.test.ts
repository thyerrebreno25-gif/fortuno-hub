import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: mocks.request }));
import { closingAccountBalance } from "./account-balance";
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00:00Z")); mocks.request.mockReset();
  mocks.request.mockImplementation(async (_client: string, path: string) => {
    if (path.endsWith("saldo-atual")) return { saldo_atual: 1000 };
    if (path.includes("contas-a-receber/buscar")) return { itens_totais: 1, itens: [{ id: "ar" }] };
    if (path.includes("contas-a-pagar/buscar")) return { itens_totais: 1, itens: [{ id: "ap" }] };
    if (path.includes("/parcelas/ar/baixa")) return [{ id: "receive", data_pagamento: "2026-11-01", conta_financeira: "account", valor_composicao: { valor_liquido: 100 } }];
    if (path.includes("/parcelas/ap/baixa")) return [{ id: "pay", data_pagamento: "2026-11-01", conta_financeira: "account", valor_composicao: { valor_liquido: 20 } }];
    if (path.includes("/transferencias?")) return { itens_totais: 1, itens: [{ id: "transfer", origem: { data: "2026-11-01", conta_financeira: { id: "account" }, composicao_valor: { valor_liquido: 30 } }, destino: { data: "2026-11-01", conta_financeira: { id: "other" }, composicao_valor: { valor_liquido: 30 } } }] };
    return { itens_totais: 1, itens: [{ id_conta_financeira: "account", data_competencia: "2026-11-01", tipo: "RECEITA", saldo_inicial: 200 }] };
  });
});
afterEach(() => vi.useRealTimers());
it("rolls back receipts, payments, transfers and opening adjustments after the cutoff", async () => {
  expect(await closingAccountBalance("company", "account", "2026-10-31")).toMatchObject({ balanceCents: 75000, method: "RECONSTRUCTED" });
  expect(mocks.request.mock.calls.every((call) => call.length === 2)).toBe(true);
  const query = mocks.request.mock.calls.find((call) => call[1].includes("contas-a-receber/buscar"))?.[1] || "";
  expect(query).toContain("data_pagamento_de=2026-11-01"); expect(query).not.toContain("ids_contas_financeiras");
});
it("uses current balance only for today's reference date, and refuses future dates", async () => {
  expect(await closingAccountBalance("company", "account", "2026-11-01")).toMatchObject({ balanceCents: 100000, method: "CURRENT" });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect((await closingAccountBalance("company", "account", "2026-11-02")).method).toBe("UNAVAILABLE");
});
it("does not convert a provider error, missing amount or incomplete pages into zero", async () => {
  mocks.request.mockResolvedValueOnce({}); expect((await closingAccountBalance("company", "account", "2026-10-31")).balanceCents).toBeNull();
  mocks.request.mockResolvedValueOnce({ saldo_atual: 1000 }).mockResolvedValueOnce({ itens_totais: 1, itens: [] });
  expect((await closingAccountBalance("company", "account", "2026-10-31")).method).toBe("UNAVAILABLE");
  mocks.request.mockRejectedValueOnce(new Error("provider unavailable")); expect((await closingAccountBalance("company", "account", "2026-10-31")).balanceCents).toBeNull();
});
it("invalidates the reconstruction if the live balance changes during the query", async () => {
  const implementation = mocks.request.getMockImplementation()!; let reads = 0;
  mocks.request.mockImplementation((client: string, path: string) => path.endsWith("saldo-atual") ? { saldo_atual: ++reads === 1 ? 1000 : 1001 } : implementation(client, path));
  expect((await closingAccountBalance("company", "account", "2026-10-31")).method).toBe("UNAVAILABLE");
});
