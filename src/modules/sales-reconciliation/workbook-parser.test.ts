import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSalesWorkbook } from "./workbook-parser";

describe("parseSalesWorkbook", () => {
  it("lê todas as linhas e normaliza DATA PG e centavos", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["DATA EV", "CLIENTE", "VALOR", "FORMA DE PAG.", "DATA PG", "VENDEDOR", "PRODUTO", "NFE OU NFCE", "CNPJ BISTRÔ OU DOCE", "CONCILIADO", "NOME NO COMPROVANTE"],
      ["01/08/2026", "Cliente A", 159, "PIX", "02/08/2026", "Ana", "Evento", "123", "Doce Maison", "", "Cliente A"],
      ["03/08/2026", "Cliente B", 75.648, "Cartão", "2026-08-04", "Bia", "Encomenda", "124", "Bistrô Maison", "OK", ""],
      ["05/08/2026", "Cliente C", 10, "PIX", "", "Bia", "Evento", "125", "Doce Maison", "", ""],
      ["06/08/2026", "Cliente D", 50, "DINHEIRO", "06/08/2026", "Bia", "Evento", "126", "Doce Maison", "", ""],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Página1");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const result = await parseSalesWorkbook(new File([bytes], "ENCOMENDAS.xlsx"));

    expect(result.validRows).toBe(2);
    expect(result.ignoredCash).toBe(1);
    expect(result.missingPaymentDate).toBe(1);
    expect(result.entries[0]).toMatchObject({ paymentDate: "2026-08-02", amount: 159, sourceRow: 2 });
    expect(result.entries[1]).toMatchObject({ paymentDate: "2026-08-04", amount: 75.65, sourceRow: 3 });
    expect(result.destinations).toEqual(["Bistrô Maison", "Doce Maison"]);
  });
});
