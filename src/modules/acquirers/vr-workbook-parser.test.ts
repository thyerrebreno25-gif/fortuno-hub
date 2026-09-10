import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";
import { parseVrBenefitsWorkbook } from "./vr-workbook-parser";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

function vrFile() {
  const rows: unknown[][] = Array.from({ length: 8 }, () => []);
  rows.push(["VR BENEFÍCIOS E SERVIÇOS DE PROCESSAMENTO LTDA"]);
  rows.push(["Endereço"]);
  rows.push([]);
  rows.push(["CNPJ", "Razão Social", "Data Inicial", "Data Final"]);
  rows.push(["00.000.000/0001-00", "Empresa Teste", "27/07/2026", "31/07/2026"]);
  rows.push([]);
  rows.push([
    "Número Guia",
    "Produto",
    "Contrato",
    "Status",
    "Corte *",
    "Pagamento *",
    "Valor Bruto",
    "Valor Líquido",
  ]);
  rows.push(["GUIA-1", "Refeição PAT", "CONTRATO-1", "Pago", "16/07/2026", "31/07/2026", 61.6, 59.38]);
  rows.push(["GUIA-2", "Refeição PAT", "CONTRATO-1", "Pago", "13/07/2026", "28/07/2026", 50, 48.2]);
  rows.push([]);
  rows.push([null, null, null, null, null, "Valor Total", 111.6, 107.58]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Guias de Reembolso",
  );
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "biff8" })],
    "extrato_reembolsos_vr.xls",
  );
}

describe("leitor de guias de reembolso da VR Benefícios", () => {
  it("transforma cada guia em bruto e taxa e confere o totalizador", async () => {
    const result = await parseVrBenefitsWorkbook(
      vrFile(),
      categories,
      "2026-07-31",
      [{
        modality: "VOUCHER",
        installments: 1,
        cardBrand: "VR Benefícios",
        rate: 3.6,
        tolerance: 0.01,
      }],
    );

    expect(result.processedSheets).toEqual(["Guias de Reembolso"]);
    expect(result.sourceRows).toBe(2);
    expect(result.lines).toHaveLength(4);
    expect(result.lines[0]).toMatchObject({
      eventType: "SALE",
      amount: 61.6,
      acquirer: "VR BENEFÍCIOS",
      transactionType: "VOUCHER",
      paymentDate: "2026-07-31",
      rateValidation: "MATCH",
    });
    expect(result.lines[1]).toMatchObject({
      eventType: "FEE",
      amount: -2.22,
      feeCategory: "SALE_FEE",
    });
    expect(result.sourceTotals).toEqual({
      rows: 2,
      gross: 111.6,
      fees: 4.02,
      net: 107.58,
    });
    expect(result.lines.reduce((sum, line) => sum + line.amount, 0))
      .toBeCloseTo(107.58, 2);
  });

  it("detecta VR Benefícios automaticamente", async () => {
    const result = await parseAcquirerWorkbook(
      vrFile(),
      categories,
      "2026-07-31",
      [],
    );

    expect(result.acquirer).toBe("VR BENEFÍCIOS");
    expect(result.parserId).toBe("vr-beneficios-guias-reembolso");
    expect(result.parserVersion).toBe("1.0.0");
  });
});
