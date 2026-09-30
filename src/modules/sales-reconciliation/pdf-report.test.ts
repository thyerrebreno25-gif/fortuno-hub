import { describe, expect, it } from "vitest";
import { createSalesReconciliationPdf } from "./pdf-report";
import type { SalesReconciliationResult } from "./types";

export function sampleSalesReconciliationResult(): SalesReconciliationResult {
  return {
    rows: [{
      id: "sheet:2",
      sourceRow: 2,
      eventDate: "2026-08-01",
      customer: "Cliente de teste",
      amount: 159.9,
      paymentMethod: "PIX",
      paymentDate: "2026-08-02",
      seller: "Ana",
      product: "Encomenda especial",
      documentNumber: "123",
      destinationLabel: "Doce Maison",
      reconciledMarker: "",
      receiptName: "Cliente de teste",
      status: "WRONG_CATEGORY",
      statusDetail: "A categoria localizada não corresponde à categoria esperada.",
      expectedCategory: "Venda de produtos",
      matchedDateField: "PAYMENT",
      contaAzul: {
        id: "ca-1",
        description: "Venda Cliente de teste",
        counterparty: "Cliente de teste",
        categoryNames: ["Outras receitas"],
        competenceDate: "2026-08-02",
        dueDate: "2026-08-02",
        paymentDate: "2026-08-02",
        amount: 159.9,
        status: "RECEBIDO",
      },
    }],
    extraContaAzul: [],
    summary: {
      spreadsheetRows: 1,
      ok: 0,
      wrongCategory: 1,
      notFound: 0,
      nearbyDate: 0,
      ambiguous: 0,
      unmapped: 0,
      negativeReview: 0,
      extraContaAzul: 0,
      spreadsheetAmount: 159.9,
      matchedAmount: 159.9,
    },
  };
}

describe("createSalesReconciliationPdf", () => {
  it("gera um PDF válido apenas com as divergências", () => {
    const document = createSalesReconciliationPdf(sampleSalesReconciliationResult(), "2026-08-01", "2026-08-31");
    const bytes = new Uint8Array(document.output("arraybuffer"));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(2_000);
  });

  it("não inclui lançamentos extras do Conta Azul nem outros status no relatório", () => {
    const result = sampleSalesReconciliationResult();
    result.rows.push(
      { ...result.rows[0], id: "sheet:3", sourceRow: 3, status: "OK" },
      { ...result.rows[0], id: "sheet:4", sourceRow: 4, status: "NEARBY_DATE" },
    );
    result.extraContaAzul = Array.from({ length: 500 }, (_, index) => ({
      ...result.rows[0].contaAzul!,
      id: `extra-${index}`,
      clientId: "client-1",
      clientName: "Cliente Conta Azul",
    }));

    const document = createSalesReconciliationPdf(result, "2026-08-01", "2026-08-31");

    expect(document.getNumberOfPages()).toBe(1);
  });
});
