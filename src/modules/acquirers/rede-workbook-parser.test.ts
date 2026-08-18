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
  });
});
