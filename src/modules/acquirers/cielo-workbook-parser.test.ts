import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseCieloWorkbook } from "./cielo-workbook-parser";
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
  "Data de pagamento",
  "Data do lançamento",
  "Estabelecimento",
  "Tipo de lançamento",
  "Forma de pagamento",
  "Bandeira",
  "Valor bruto",
  "Taxa/tarifa",
  "Valor líquido",
  "Status de pagamento",
  "Data da venda",
  "Data prevista de pagamento",
  "Número da parcela",
  "Quantidade total de parcelas",
  "Canal da venda",
  "Modalidade",
  "Taxa total (%)",
  "Taxa administrativa (MDR) (%)",
  "Taxa do prazo de recebimento",
  "Valor da taxa administrativa (MDR)",
  "Valor da taxa do prazo de recebimento",
  "Banco",
  "Agência",
  "Conta",
  "TID",
];

type CieloRow = [
  gross: number,
  fee: number,
  brand: string,
  installment: number,
  installments: number,
  rate: number,
  establishment: string,
  account: string,
  bank?: string,
];

function detailedWorkbook(rows: CieloRow[]) {
  const gross = rows.reduce((sum, row) => sum + row[0], 0);
  const fees = rows.reduce((sum, row) => sum + Math.abs(row[1]), 0);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [null, "Central de Relacionamento", null, "Informações de acesso"],
    ["Recebíveis Detalhado - Lançamentos"],
    [],
    ["Filtros: Data de pagamento"],
    [],
    ["Totalizador"],
    ["Quantidade de lançamentos", "Valor bruto", "Taxa/tarifa", "Valor líquido"],
    [rows.length, gross, -fees, gross - fees],
    [],
    headers,
    ...rows.map(([rowGross, rowFee, brand, installment, installments, rate, establishment, account, bank = "Banco A"], index) => [
      "17/04/2026",
      "15/02/2026",
      establishment,
      "Venda parcelada",
      "Crédito parcelado loja",
      brand,
      rowGross,
      rowFee,
      rowGross + rowFee,
      "Pago",
      "15/02/2026",
      "17/04/2026",
      installment,
      installments,
      "E-Commerce",
      "Link de pagamento",
      rate,
      rate,
      0,
      rowFee,
      0,
      bank,
      "0001",
      account,
      `TID-${index + 1}`,
    ]),
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Recebiveis_cielo_detalhe1");
  const content = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([content], "recebiveis-cielo.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

const referenceRows: CieloRow[] = [
  [149.8, -6.32, "Visa", 10, 10, 4.22, "1000000001", "1111-1"],
  [299.6, -14.56, "Mastercard", 7, 10, 4.86, "1000000001", "1111-1"],
  [1598, -73.19, "Visa", 3, 3, 4.58, "1000000001", "1111-1"],
  [799, -38.67, "Mastercard", 2, 4, 4.84, "1000000001", "1111-1"],
  [1065.33, -44.1, "Mastercard", 2, 3, 4.14, "1000000002", "2222-2", "Banco do Brasil"],
  [333.33, -16.13, "Mastercard", 2, 3, 4.84, "1000000001", "1111-1"],
  [359.66, -17.41, "Mastercard", 2, 3, 4.84, "1000000001", "1111-1"],
  [259.6, -10.96, "Visa", 1, 10, 4.22, "1000000001", "1111-1"],
];

describe("leitor de recebíveis detalhados da Cielo", () => {
  it("reconcilia venda bruta, MDR e líquido do layout de referência", async () => {
    const result = await parseCieloWorkbook(
      detailedWorkbook(referenceRows),
      categories,
      "2026-04-17",
      [],
    );

    const gross = result.lines
      .filter((line) => line.eventType === "SALE")
      .reduce((sum, line) => sum + line.amount, 0);
    const fees = result.lines
      .filter((line) => line.eventType === "FEE")
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const net = result.lines.reduce((sum, line) => sum + line.amount, 0);

    expect(result.sourceRows).toBe(8);
    expect(result.lines).toHaveLength(16);
    expect(gross).toBeCloseTo(4864.32, 2);
    expect(fees).toBeCloseTo(221.34, 2);
    expect(net).toBeCloseTo(4642.98, 2);
    expect(result.sourceTotals).toEqual({
      rows: 8,
      gross: 4864.32,
      fees: 221.34,
      net: 4642.98,
    });
    expect(result.lines.every((line) => line.acquirer === "CIELO")).toBe(true);
    expect(result.lines[0]).toMatchObject({
      eventType: "SALE",
      transactionType: "CREDIT",
      installments: 10,
      cardBrand: "Visa",
    });
  });

  it("aplica a orientação de conta também no layout Cielo", async () => {
    const { rules } = interpretReadingInstructions("Ignorar conta 2222-2");
    const result = await parseCieloWorkbook(
      detailedWorkbook(referenceRows),
      categories,
      "2026-04-17",
      [],
      { readingRules: rules },
    );

    expect(result.instructionSummary.excludedRows).toBe(1);
    expect(result.lines).toHaveLength(14);
    expect(result.lines.reduce((sum, line) => sum + line.amount, 0))
      .toBeCloseTo(3621.75, 2);
  });

  it("distingue banco de conta ao aplicar a orientação no layout Cielo", async () => {
    const { rules } = interpretReadingInstructions(
      "Não quero os dados da conta do Banco do Brasil",
    );
    const result = await parseCieloWorkbook(
      detailedWorkbook(referenceRows),
      categories,
      "2026-04-17",
      [],
      { readingRules: rules },
    );

    expect(result.instructionSummary.excludedRows).toBe(1);
    expect(result.lines).toHaveLength(14);
    expect(result.lines.reduce((sum, line) => sum + line.amount, 0))
      .toBeCloseTo(3621.75, 2);
  });

  it("detecta Cielo automaticamente e usa somente as taxas dessa adquirente", async () => {
    const result = await parseAcquirerWorkbook(
      detailedWorkbook([referenceRows[0]]),
      categories,
      "2026-04-17",
      [
        {
          name: "Rede",
          rates: [{ modality: "CREDIT", installments: 2, cardBrand: "Visa", rate: 99, tolerance: 0.01 }],
        },
        {
          name: "Cielo",
          rates: [{ modality: "CREDIT", installments: 2, cardBrand: "Visa", rate: 4.22, tolerance: 0.01 }],
        },
      ],
    );

    expect(result.acquirer).toBe("CIELO");
    expect(result.parserId).toBe("cielo-recebiveis-detalhado");
    expect(result.lines.find((line) => line.eventType === "SALE"))
      .toMatchObject({ rateValidation: "MATCH", contractedRate: 4.22 });
  });

  it("classifica cancelamento, contestação, aluguel e ajuste a crédito", async () => {
    const workbook = XLSX.utils.book_new();
    const eventRows = [
      ["17/04/2026", "17/04/2026", "EC", "Cancelamento de venda", "Crédito", "Visa", 100, 0, 100, "Pago"],
      ["17/04/2026", "17/04/2026", "EC", "Contestação do portador do cartão", "Crédito", "Visa", 50, 0, 50, "Pago"],
      ["17/04/2026", "17/04/2026", "EC", "Aluguel de máquina", "", "", 0, -30, -30, "Pago"],
      ["17/04/2026", "17/04/2026", "EC", "Ajuste a crédito", "", "", 20, 0, 20, "Pago"],
    ];
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Recebíveis Detalhado - Lançamentos"],
      headers,
      ...eventRows,
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Detalhado");
    const file = new File(
      [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
      "eventos-cielo.xlsx",
    );
    const result = await parseCieloWorkbook(file, categories, "2026-04-17", []);

    expect(result.lines.map((line) => [line.eventType, line.feeCategory, line.amount])).toEqual([
      ["CANCELLATION", "CANCELLATION", -100],
      ["CHARGEBACK", "CHARGEBACK", -50],
      ["ADJUSTMENT", "EQUIPMENT", -30],
      ["ADJUSTMENT", "ADJUSTMENT", 20],
    ]);
  });
});
