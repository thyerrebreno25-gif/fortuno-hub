import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { interpretReadingInstructions } from "./reading-instructions";
import { parseRedeWorkbook } from "./rede-workbook-parser";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

function createRedeWorkbookFile() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Relatório de recebimentos"],
    ["Data", "Valor depositado", "Conta corrente", "Bandeira", "Modalidade", "Nome do estabelecimento"],
    ["10/07/2026", 150, "Ag. 0001 / Conta 12345-6", "Visa", "Crédito", "Empresa X"],
    ["10/07/2026", 275, "Ag. 0001 / Conta 99999-0", "Visa", "Crédito", "Empresa X"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Recebidos");
  const content = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([content], "recebimentos.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function workbookFile(
  sheets: Array<{ name: string; headers: string[]; rows: unknown[][] }>,
) {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Relatório de recebimentos"],
        sheet.headers,
        ...sheet.rows,
      ]),
      sheet.name,
    );
  }
  const content = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new File([content], "recebimentos-rede.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("leitor de planilhas da Rede", () => {
  it("remove os recebimentos da conta indicada e mantém as demais contas", async () => {
    const { rules } = interpretReadingInstructions(
      "Não quero os dados da conta 12345-6",
    );

    const result = await parseRedeWorkbook(
      createRedeWorkbookFile(),
      categories,
      "2026-07-10",
      [],
      { readingRules: rules },
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].amount).toBe(275);
    expect(result.instructionSummary.excludedRows).toBe(1);
    expect(result.instructionSummary.matchesByRule[rules[0].id]).toBe(1);
    expect(result.instructionSummary.unmatchedRuleIds).toEqual([]);
    expect(result.sourceTotals).toEqual({ rows: 2, gross: 425, fees: 0, net: 425 });
  });

  it("cria venda e MDR pelos pagamentos detalhados e usa recebidos como totalizador", async () => {
    const file = workbookFile([
      {
        name: "pagamentos",
        headers: [
          "data do recebimento",
          "data original da venda",
          "data original de vencimento",
          "valor bruto da parcela original",
          "valor bruto da parcela atualizada",
          "taxa MDR",
          "valor MDR descontado",
          "valor líquido da parcela",
          "NSU/CV",
          "modalidade",
          "bandeira",
          "número de parcelas",
          "status",
        ],
        rows: [
          ["10/07/2026", "09/07/2026", "10/07/2026", 100, "-", 0.02, 2, 98, "123", "Crédito", "Visa", 1, "paga"],
          ["11/07/2026", "10/07/2026", "11/07/2026", 50, 0, 0.02, 0, 0, "999", "Crédito", "Visa", 1, "desagendada"],
        ],
      },
      {
        name: "recebidos",
        headers: ["data", "bandeira", "modalidade", "valor depositado", "status", "negociadas"],
        rows: [["10/07/2026", "Visa", "Crédito", 98, "PAGO", "Pagamento livre"]],
      },
    ]);

    const result = await parseRedeWorkbook(file, categories, "2026-07-10", [], {});

    expect(result.lines.map((line) => [line.eventType, line.amount])).toEqual([
      ["SALE", 100],
      ["FEE", -2],
    ]);
    expect(result.lines[0].sourceMetadata?.["nsu/cv"]).toBe("123");
    expect(result.sourceTotals).toEqual({ rows: 1, gross: 100, fees: 2, net: 98 });
  });

  it("mantém uma única ocorrência quando ajustes repete o chargeback da aba específica", async () => {
    const file = workbookFile([
      {
        name: "ajustes",
        headers: [
          "data do ajuste",
          "motivo",
          "valor cobrado nesta data",
          "resumo de vendas/número do lote ajustado",
        ],
        rows: [["10/08/2026", "contestação de venda", 49.58, "31431871"]],
      },
      {
        name: "cancelamentos e contestações",
        headers: [
          "data do débito",
          "cancelamento/chargeback",
          "data original da venda",
          "valor original da venda",
          "valor descontado",
          "motivo do cancelamento",
          "modalidade da venda",
          "bandeira da venda",
          "número de parcelas",
          "NSU/CV",
          "resumo de vendas/número do lote ajustado",
        ],
        rows: [["10/08/2026", "chargeback", "20/06/2026", 50, 49.58, "contestação da venda", "crédito", "Mastercard", 1, "250722541", "31431871"]],
      },
    ]);

    const result = await parseRedeWorkbook(file, categories, "2026-08-10", [], {});
    const chargebacks = result.lines.filter((line) => line.eventType === "CHARGEBACK");

    expect(chargebacks).toHaveLength(1);
    expect(chargebacks[0]).toMatchObject({
      sourceSheet: "cancelamentos e contestações",
      amount: -49.58,
      category: categories.chargeback,
    });
  });

  it("recompõe a tarifa de venda desagendada quando o cancelamento foi debitado no período", async () => {
    const file = workbookFile([
      {
        name: "pagamentos",
        headers: [
          "data do recebimento",
          "data original da venda",
          "data original de vencimento",
          "valor bruto da parcela original",
          "valor bruto da parcela atualizada",
          "taxa MDR",
          "valor MDR descontado",
          "NSU/CV",
          "modalidade",
          "bandeira",
          "número de parcelas",
          "status",
        ],
        rows: [["10/08/2026", "06/08/2026", "08/09/2026", 579, 0, 0.0084, 0, "625371719", "Crédito", "Mastercard", 1, "desagendada"]],
      },
      {
        name: "ajustes",
        headers: ["data do ajuste", "motivo", "valor cobrado nesta data", "resumo de vendas/número do lote ajustado"],
        rows: [["17/08/2026", "cancelamento de vendas", 574.14, "226199993"]],
      },
      {
        name: "cancelamentos e contestações",
        headers: [
          "data do débito",
          "cancelamento/chargeback",
          "data original da venda",
          "valor original da venda",
          "valor descontado",
          "motivo do cancelamento",
          "modalidade da venda",
          "bandeira da venda",
          "número de parcelas",
          "NSU/CV",
          "resumo de vendas/número do lote ajustado",
        ],
        rows: [["17/08/2026", "cancelamento", "06/08/2026", 579, 574.14, "cancelamento da venda", "crédito", "Mastercard", 1, "625371719", "226199993"]],
      },
    ]);

    const result = await parseRedeWorkbook(file, categories, "2026-08-17", [], {});

    expect(result.lines.map((line) => [line.eventType, line.amount])).toEqual([
      ["SALE", 579],
      ["FEE", -4.86],
      ["CANCELLATION", -574.14],
    ]);
    expect(result.lines.reduce((total, line) => total + line.amount, 0)).toBe(0);
  });
});
