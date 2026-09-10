import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAleloWorkbook } from "./alelo-workbook-parser";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

function aleloFile() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [],
      [null, "Recebimentos do CNPJ operado por: Alelo Instituição de Pagamentos S.A."],
    ]),
    "Instruções",
  );
  const receipt = [
    "00.000.000/0001-00",
    "EC-1",
    "Empresa Teste",
    "EC-1",
    "10/08/2026",
    "10:30:00",
    "TRX-1",
    "AUT-1",
    "Refeição PAT",
    "5067********0000",
    "Rede",
    100,
    96.5,
    "Aprovada",
    "25/08/2026",
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([[], receipt, receipt]),
    "Recebimentos",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      [],
      ["00.000.000/0001-00", "EC-1", "Empresa Teste", "EC-1", "Refeição PAT", "Tarifa TOR", -1.22, "25/08/2026", "25/08/2026"],
      ["00.000.000/0001-00", "EC-1", "Empresa Teste", "EC-1", "Refeição PAT", "Compensação", 1.22, "26/08/2026", "26/08/2026"],
    ]),
    "Outras Transações",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["EC", "Motivo"]]),
    "Não Exportadas",
  );

  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "Recebimentos_Alelo.xlsx",
  );
}

describe("leitor de recebimentos da Alelo", () => {
  it("separa venda, MDR e outras transações sem duplicar a venda", async () => {
    const result = await parseAleloWorkbook(
      aleloFile(),
      categories,
      "2026-08-25",
      [{
        modality: "VOUCHER",
        installments: 1,
        cardBrand: "Alelo",
        rate: 3.5,
        tolerance: 0.01,
      }],
    );

    expect(result.processedSheets).toEqual(["Recebimentos", "Outras Transações"]);
    expect(result.sourceRows).toBe(3);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[0]).toMatchObject({
      eventType: "SALE",
      amount: 100,
      acquirer: "ALELO",
      transactionType: "VOUCHER",
      cardBrand: "Alelo",
      paymentDate: "2026-08-25",
      rateValidation: "MATCH",
    });
    expect(result.lines[1]).toMatchObject({
      eventType: "FEE",
      amount: -3.5,
      feeCategory: "SALE_FEE",
    });
    expect(result.lines[2]).toMatchObject({
      eventType: "FEE",
      amount: -1.22,
      feeCategory: "OTHER",
    });
    expect(result.lines[3]).toMatchObject({
      eventType: "ADJUSTMENT",
      amount: 1.22,
    });
    expect(result.sourceTotals).toEqual({
      rows: 1,
      gross: 100,
      fees: 4.72,
      net: 96.5,
    });
  });

  it("detecta Alelo automaticamente", async () => {
    const result = await parseAcquirerWorkbook(
      aleloFile(),
      categories,
      "2026-08-25",
      [],
    );

    expect(result.acquirer).toBe("ALELO");
    expect(result.parserId).toBe("alelo-recebimentos");
    expect(result.parserVersion).toBe("1.0.0");
  });
});
