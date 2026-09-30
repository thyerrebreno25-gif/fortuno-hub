import { describe, expect, it } from "vitest";
import { reconcileSales } from "./engine";
import type { ContaAzulReceivable, SalesSpreadsheetEntry } from "./types";

function entry(id: string, patch: Partial<SalesSpreadsheetEntry> = {}): SalesSpreadsheetEntry {
  return {
    id,
    sourceRow: Number(id.replace(/\D/g, "")) || 2,
    eventDate: null,
    customer: "Cliente A",
    amount: 100,
    paymentMethod: "PIX",
    paymentDate: "2026-08-10",
    seller: "Ana",
    product: "Encomenda",
    documentNumber: "",
    destinationLabel: "Doce Maison",
    reconciledMarker: "",
    receiptName: "",
    ...patch,
  };
}

function receivable(id: string, patch: Partial<ContaAzulReceivable> = {}): ContaAzulReceivable {
  return {
    id,
    description: "Venda Cliente A",
    counterparty: "Cliente A",
    categoryNames: ["Venda de produtos"],
    competenceDate: "2026-08-10",
    dueDate: "2026-08-10",
    paymentDate: "2026-08-10",
    amount: 100,
    status: "RECEBIDO",
    ...patch,
  };
}

describe("reconcileSales", () => {
  const rules = [{ sourceLabel: "Doce Maison", clientId: "client-1", expectedCategoryName: "Venda de produtos" }];

  it("exige valor exato em centavos e valida a categoria", () => {
    const result = reconcileSales({
      entries: [entry("row-2"), entry("row-3", { amount: 100.01, customer: "Cliente B" })],
      rules,
      receivablesByClient: { "client-1": { clientName: "Doce", items: [receivable("ca-1")] } },
    });
    expect(result.rows.map((row) => row.status)).toEqual(["OK", "NOT_FOUND"]);
    expect(result.summary.matchedAmount).toBe(100);
  });

  it("não considera data próxima como conferência", () => {
    const result = reconcileSales({
      entries: [entry("row-2")],
      rules,
      receivablesByClient: {
        "client-1": { clientName: "Doce", items: [receivable("ca-1", { competenceDate: "2026-08-12", dueDate: "2026-08-12", paymentDate: null })] },
      },
    });
    expect(result.rows[0].status).toBe("NEARBY_DATE");
    expect(result.summary.ok).toBe(0);
  });

  it("consome cada lançamento do Conta Azul somente uma vez", () => {
    const result = reconcileSales({
      entries: [entry("row-2"), entry("row-3")],
      rules,
      receivablesByClient: { "client-1": { clientName: "Doce", items: [receivable("ca-1")] } },
    });
    expect(result.rows.map((row) => row.status)).toEqual(["OK", "NOT_FOUND"]);
  });

  it("sinaliza categoria divergente", () => {
    const result = reconcileSales({
      entries: [entry("row-2")],
      rules,
      receivablesByClient: { "client-1": { clientName: "Doce", items: [receivable("ca-1", { categoryNames: ["Outras receitas"] })] } },
    });
    expect(result.rows[0].status).toBe("WRONG_CATEGORY");
  });

  it("não considera conferido quando a categoria esperada não foi configurada", () => {
    const result = reconcileSales({
      entries: [entry("row-2")],
      rules: [{ sourceLabel: "Doce Maison", clientId: "client-1" }],
      receivablesByClient: { "client-1": { clientName: "Doce", items: [receivable("ca-1")] } },
    });
    expect(result.rows[0].status).toBe("WRONG_CATEGORY");
    expect(result.rows[0].statusDetail).toContain("não foi configurada");
  });
});
