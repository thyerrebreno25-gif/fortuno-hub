import { describe, expect, it } from "vitest";
import { parseBrasilmedPayroll } from "./parser";

// O módulo está desativado: não apresentar uma folha vazia como importação válida.
describe("BrasilMed temporariamente indisponível", () => {
  it("retorna aviso e nenhum lançamento mesmo quando o arquivo contém valores", () => {
    const result = parseBrasilmedPayroll("Total Geral --> R$ 21.706,86\n04737-8 R$ 10.767,23");
    expect(result.rows).toEqual([]);
    expect(result.employeeCount).toBe(0);
    expect(result.expectedTotal).toBe(0);
    expect(result.warnings).toContain("O módulo BrasilMed está temporariamente indisponível.");
  });
});
