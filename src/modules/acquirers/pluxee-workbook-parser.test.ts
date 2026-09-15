import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";
import { parsePluxeeWorkbook } from "./pluxee-workbook-parser";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

function pluxeeFile() {
  const rows: unknown[][] = [
    ["Extrato de pagamentos Pluxee"],
    [],
    ["CNPJ", "00.000.000/0001-00", null, null, null, null, null, null, "Banco", "1"],
    ["Nome Fantasia", "Empresa Teste"],
    [],
    [],
    [],
    ["Produto", "PLUXEE REFEICAO"],
    ["Filtro selecionado", "01/08/2026 até 31/08/2026", null, null, null, null, null, null, "TOTAL BRUTO PERÍODO", null, 300],
    [null, null, null, null, null, null, null, null, "VALOR TAXAS", "TOTAL TAXAS", 10.5],
    [null, null, null, null, null, null, null, null, null, "TAXA DE ADMINISTRACAO - PAT*", 7],
    [null, null, null, null, null, null, null, null, null, "TAXA DE ADMINISTRACAO - AUXILIO", 3.5],
    [null, null, null, null, null, null, null, null, "SERVIÇOS CONTRATADOS", "TOTAL SRV. CONTRATADO", 0],
    [],
    [null, null, null, null, null, null, null, null, "OUTRAS DEDUÇÕES", "TOTAL OUTRAS DEDUÇÕES", 0],
    [],
    [null, null, null, null, null, null, null, null, "TOTAL LÍQUIDO", null, 289.5],
    [],
    [],
    [],
    [
      "CNPJ",
      "Razão Social",
      "Data da Transação",
      "Data do Processamento",
      "Data do Pagamento",
      "Status",
      "Rede Captura",
      "Descrição",
      "Número do cartão",
      "Nº de Autorização",
      "Valor Bruto R$",
      "Origem",
      "Taxa de Administração",
    ],
    ["00.000.000/0001-00", "Empresa Teste", "01/08/2026", "02/08/2026", "10/08/2026", "PAGO", "REDE", "COMPRAS", "****1111", "AUT-1", "R$ 100,00", "AUXILIO"],
    ["00.000.000/0001-00", "Empresa Teste", "02/08/2026", "03/08/2026", "11/08/2026", "PAGO", "REDE", "COMPRAS", "****2222", "AUT-2", "R$ 200,00", "PAT - PUBLICO"],
    ["00.000.000/0001-00", "Empresa Teste", "02/08/2026", "03/08/2026", "11/08/2026", "PAGO", "REDE", "COMPRAS", "****2222", "AUT-2", "R$ 200,00", "PAT - PUBLICO"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "extrato_pagamentos",
  );
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "extrato_pgtos.xlsx",
  );
}

describe("leitor do extrato de pagamentos da Pluxee", () => {
  it("separa vendas e taxas, confere o resumo e elimina duplicidades", async () => {
    const result = await parsePluxeeWorkbook(
      pluxeeFile(),
      categories,
      "2026-08-31",
      [{
        modality: "VOUCHER",
        installments: 1,
        cardBrand: "Pluxee",
        rate: 3.5,
        tolerance: 0.01,
      }],
    );

    expect(result.processedSheets).toEqual(["extrato_pagamentos"]);
    expect(result.sourceRows).toBe(2);
    expect(result.lines).toHaveLength(4);
    expect(result.lines.filter((line) => line.eventType === "SALE")).toHaveLength(2);
    expect(result.lines.filter((line) => line.eventType === "FEE")).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({
      eventType: "SALE",
      amount: 100,
      paymentDate: "2026-08-10",
      acquirer: "PLUXEE",
      transactionType: "VOUCHER",
      rateValidation: "MATCH",
    });
    expect(result.lines.reduce((sum, line) => sum + line.amount, 0)).toBeCloseTo(289.5, 2);
    expect(result.sourceTotals).toEqual({
      rows: 2,
      gross: 300,
      fees: 10.5,
      net: 289.5,
    });
  });

  it("detecta Pluxee automaticamente", async () => {
    const result = await parseAcquirerWorkbook(
      pluxeeFile(),
      categories,
      "2026-08-31",
      [],
    );

    expect(result.acquirer).toBe("PLUXEE");
    expect(result.parserId).toBe("pluxee-extrato-pagamentos");
  });
});
