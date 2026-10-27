import { beforeEach, afterEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/modules/purchase-invoices/server/conta-azul", () => ({ contaAzulRequest: request }));
import { fetchManagementSnapshot } from "./source";
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T12:00:00Z")); });
afterEach(() => vi.useRealTimers());
it("fetches both flows and per-account balances sequentially and preserves unavailable balances", async () => {
  request.mockResolvedValueOnce({ itens: [{ id: "p", descricao: "Aluguel", data_vencimento: "2026-10-26", nao_pago: 50, total: 100 }] })
    .mockResolvedValueOnce({ itens: [{ id: "r", descricao: "Serviço", data_vencimento: "2026-10-25", nao_pago: 25 }] })
    .mockResolvedValueOnce({ itens: [{ id: "a", nome: "Banco", banco: "INTER" }] })
    .mockResolvedValueOnce({ saldo_atual: null });
  const snapshot = await fetchManagementSnapshot("c");
  expect(snapshot.payable).toMatchObject({ amount: 50, count: 1, complete: true });
  expect(snapshot.receivable.amount).toBe(25); expect(snapshot.accounts[0].balance).toBeNull();
  expect(snapshot.accounts[0].error).toContain("não informado");
  expect(request.mock.calls.map((call) => call[1])).toEqual([
    expect.stringContaining("contas-a-pagar/buscar"), expect.stringContaining("contas-a-receber/buscar"), expect.stringContaining("/v1/conta-financeira?"), "/v1/conta-financeira/a/saldo-atual",
  ]);
  expect(request.mock.calls[0][1]).toContain("data_vencimento_ate=2026-10-26");
});
it("does not report an upstream failure as zero overdue or reconciled accounts", async () => {
  request.mockRejectedValue(new Error("provider failure"));
  const snapshot = await fetchManagementSnapshot("c");
  expect(snapshot.payable.complete).toBe(false); expect(snapshot.payable.error).toBeTruthy();
  expect(snapshot.receivable.complete).toBe(false); expect(snapshot.accountsComplete).toBe(false); expect(snapshot.accountsError).toBeTruthy();
});
it("does not interpret a malformed success response as an empty financial ledger", async () => {
  request.mockResolvedValue({ unexpected: true });
  const snapshot = await fetchManagementSnapshot("c");
  expect(snapshot.payable.complete).toBe(false); expect(snapshot.payable.error).toBeTruthy();
  expect(snapshot.accountsComplete).toBe(false);
});
it("deduplicates paged overdue titles and counts beyond the visible detail sample", async () => {
  const page = Array.from({ length: 1000 }, (_, index) => ({ id: String(index), data_vencimento: "2026-10-25", nao_pago: 1 }));
  request.mockResolvedValueOnce({ itens: page }).mockResolvedValueOnce({ itens: [page[0], { id: "1000", data_vencimento: "2026-10-25", nao_pago: 1 }] }).mockResolvedValueOnce({ itens: [] }).mockResolvedValueOnce({ itens: [] });
  const snapshot = await fetchManagementSnapshot("c");
  expect(snapshot.payable).toMatchObject({ count: 1001, amount: 1001, complete: true });
  expect(snapshot.payable.items).toHaveLength(200);
  expect(request.mock.calls[1][1]).toContain("pagina=2");
});
