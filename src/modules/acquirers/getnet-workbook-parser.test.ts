import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseGetnetWorkbook } from "./getnet-workbook-parser";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";
import { interpretReadingInstructions } from "./reading-instructions";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

const headers = [
  "EC CENTRALIZADOR",
  "ESTABELECIMENTO COMERCIAL",
  "CPF / CNPJ",
  "DATA DE VENCIMENTO",
  "BANDEIRA / MODALIDADE",
  "TIPO DE LANÇAMENTO",
  "LANÇAMENTO",
  "VALOR LÍQUIDO",
  "VALOR LIQUIDADO",
  "NÚMERO DO CARTÃO",
  "AUTORIZAÇÃO",
  "NÚMERO COMPROVANTE DE VENDA (NSU)",
  "TERMINAL LÓGICO",
  "DATA DA VENDA",
  "HORA DA VENDA",
  "VALOR DA VENDA",
  "PARCELAS",
  "VALOR DA PARCELA",
  "DESCONTOS",
  "VALOR LIQUIDO DA PARCELA",
  "DATA DA CONTRATAÇÃO DO CONTRATO",
  "INSTITUIÇÃO NEGOCIADORA",
  "CONTRATO REGISTRADORA",
  "VALOR ATUAL DO CONTRATO",
  "VALOR LIQUIDADO DO CONTRATO",
  "VALOR A LIQUIDAR DO CONTRATO",
];

function getnetFile(establishment = "7647291") {
  const base = [
    "7647291",
    establishment,
    "37.302.350/0001-12",
    "03/08/2026",
    "Mastercard Crédito",
  ];
  const emptyContract = [null, null, null, null, null, null];
  const rows = [
    [...base, "Saldo Anterior", "Saldo Anterior", 0, 0, "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", ...emptyContract],
    [...base, "Vendas", "Venda Parcelado Loja", 551.05, 551.05, "515590******1665", "575673", "000004577", "13218493", "01/11/2025", "09:57:37", 5650, "9 de 10", 565, -13.95, 551.05, ...emptyContract],
    [...base, "Pagamento Realizado", "Valor Liquidado (R$)", -551.05, -551.05, "-", "-", "-", "-", "-", "-", "-", "-", "-", "-", -551.05, ...emptyContract],
    ["Total Recebido", null, null, null, null, null, null, null, 551.05],
    ["TOTAL", null, null, null, null, null, null, null, 551.05],
  ];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [null, null, "Razão Social: Empresa Teste", null, "Data Extrato: 17/08/2026"],
    [null, null, "CNPJ: 37.302.350/0001-12", null, "Periodo: 03/08/2026 a 14/08/2026"],
    [],
    ["Recebimentos - Extrato Detalhado"],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Detalhado");
  const content = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([content], "recebiveis-getnet.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("leitor de recebíveis detalhados da GETNET", () => {
  it("exporta bruto e MDR sem duplicar saldo, pagamento e totalizadores", async () => {
    const result = await parseGetnetWorkbook(
      getnetFile(),
      categories,
      "2026-08-03",
      [],
    );

    expect(result.processedSheets).toEqual(["Detalhado"]);
    expect(result.sourceRows).toBe(1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      eventType: "SALE",
      amount: 565,
      acquirer: "GETNET",
      transactionType: "CREDIT",
      cardBrand: "Mastercard",
      installments: 10,
      saleDate: "2025-11-01",
      paymentDate: "2026-08-03",
    });
    expect(result.lines[0].chargedRate).toBeCloseTo(2.469, 3);
    expect(result.lines[1]).toMatchObject({
      eventType: "FEE",
      amount: -13.95,
      feeCategory: "SALE_FEE",
    });
    expect(result.lines.reduce((sum, line) => sum + line.amount, 0))
      .toBeCloseTo(551.05, 2);
    expect(result.sourceTotals).toEqual({
      rows: 1,
      gross: 565,
      fees: 13.95,
      net: 551.05,
    });
  });

  it("detecta GETNET automaticamente e usa a taxa cadastrada da GETNET", async () => {
    const result = await parseAcquirerWorkbook(
      getnetFile(),
      categories,
      "2026-08-03",
      [
        {
          name: "Getnet",
          rates: [{
            modality: "CREDIT",
            installments: 2,
            cardBrand: "Mastercard",
            rate: 2.469,
            tolerance: 0.01,
          }],
        },
      ],
    );

    expect(result.acquirer).toBe("GETNET");
    expect(result.parserId).toBe("getnet-recebiveis-detalhado");
    expect(result.lines[0]).toMatchObject({
      rateValidation: "MATCH",
      contractedRate: 2.469,
    });
  });

  it("aplica orientações ao estabelecimento comercial", async () => {
    const { rules } = interpretReadingInstructions(
      "Ignorar estabelecimento 9999999",
    );
    const result = await parseGetnetWorkbook(
      getnetFile("9999999"),
      categories,
      "2026-08-03",
      [],
      { readingRules: rules },
    );

    expect(result.lines).toHaveLength(0);
    expect(result.instructionSummary.excludedRows).toBe(1);
    expect(result.instructionSummary.unmatchedRuleIds).toEqual([]);
  });
});
