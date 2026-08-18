import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

function workbookFile(sheetName: string, rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "adquirente.xlsx",
  );
}

describe("detecção automática de adquirentes", () => {
  it("mantém o leitor Rede disponível", async () => {
    const file = workbookFile("Recebidos", [
      ["Relatório Rede"],
      ["Data", "Valor depositado", "Bandeira", "Modalidade", "Nome do estabelecimento"],
      ["10/07/2026", 100, "Visa", "Crédito", "Empresa A"],
    ]);

    const result = await parseAcquirerWorkbook(
      file,
      categories,
      "2026-07-10",
      [],
    );

    expect(result.acquirer).toBe("REDE");
    expect(result.parserId).toBe("rede-workbook");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ acquirer: "REDE", amount: 100 });
  });

  it("recusa um layout desconhecido sem tentar adivinhar", async () => {
    const file = workbookFile("Planilha", [
      ["Coluna A", "Coluna B"],
      ["valor", 10],
    ]);

    await expect(parseAcquirerWorkbook(
      file,
      categories,
      "2026-07-10",
      [],
    )).rejects.toThrow("Layout de adquirente ainda não reconhecido");
  });
});
