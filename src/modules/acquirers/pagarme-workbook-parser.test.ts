import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";
import { parsePagarmeWorkbook } from "./pagarme-workbook-parser";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

const headers = [
  "Data da operação",
  "Tipo da operação",
  "Id da operação",
  "Descrição da operação",
  "Id da transação",
  "Parcela",
  "Método de pagamento",
  "Entrada bruta",
  "Saída bruta",
  "Taxa de operação",
  "Taxa de antecipação",
  "Taxa total da operação",
  "Entrada líquida",
  "Saída líquida",
  "Id do arranjo",
];

function pagarmeFile() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ["31/08/2026 11:59", "Liquidação", "liq-1", "mastercard", "-", "-", "Antecipação", "100,00", "0,00", "0,00", "0,00", "0,00", "100,00", "0,00", "arr-1"],
    ["30/08/2026 08:10", "Liquidação", "liq-2", "visa", "-", "-", "Cartão de Crédito", "200,00", "0,00", "0,00", "0,00", "0,00", "200,00", "0,00", "arr-2"],
    ["31/08/2026 12:37", "Transferência", "ted-1", "Transferência TED", "-", "-", "-", "0,00", "-299,00", "-3,67", "0,00", "-3,67", "0,00", "-302,67", "-"],
    ["04/08/2026 20:51", "Operação de saldo", "gateway-1", "Serviços de gateway (01/07/2026 a 31/07/2026)", "-", "-", "-", "0,00", "-5,00", "0,00", "0,00", "0,00", "0,00", "-5,00", "-"],
    ["31/08/2026 02:34", "Operação de saldo", "yield-1", "Rendimentos automáticos", "-", "-", "-", "0,10", "0,00", "0,00", "0,00", "0,00", "0,10", "0,00", "-"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "pagarme");
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "PagarMe_Extrato_Movimentacoes.xlsx",
  );
}

describe("leitor do extrato de movimentações da Pagar.me", () => {
  it("lê liquidações e custos sem transformar o saque em nova despesa", async () => {
    const result = await parsePagarmeWorkbook(
      pagarmeFile(),
      categories,
      "2026-08-31",
    );

    expect(result.processedSheets).toEqual(["pagarme"]);
    expect(result.sourceRows).toBe(5);
    expect(result.lines).toHaveLength(5);
    expect(result.lines.filter((line) => line.eventType === "SALE"))
      .toHaveLength(2);
    expect(result.lines.some((line) => Math.abs(line.amount) === 299)).toBe(false);
    expect(result.lines.find((line) => line.sourceRow === 4)).toMatchObject({
      eventType: "FEE",
      amount: -3.67,
      feeCategory: "OTHER",
    });
    expect(result.lines.find((line) => line.sourceRow === 5)).toMatchObject({
      eventType: "FEE",
      amount: -5,
    });
    expect(result.lines.find((line) => line.sourceRow === 6)).toMatchObject({
      eventType: "ADJUSTMENT",
      amount: 0.1,
    });
    expect(result.sourceTotals).toEqual({
      rows: 2,
      gross: 300,
      fees: 8.67,
      net: 291.43,
    });
  });

  it("detecta a Pagar.me automaticamente", async () => {
    const result = await parseAcquirerWorkbook(
      pagarmeFile(),
      categories,
      "2026-08-31",
      [],
    );

    expect(result.acquirer).toBe("PAGARME");
    expect(result.parserId).toBe("pagarme-extrato-movimentacoes");
    expect(result.parserVersion).toBe("1.0.0");
  });
});
