import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";
import { parseTicketWorkbook } from "./ticket-workbook-parser";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

function ticketFile() {
  const rows: unknown[][] = [
    ["Empresa", "Empresa Teste"],
    ["CNPJ", "00.000.000/0001-00"],
    ["Emissão", "15/09/2026"],
    ["Período", "01/08/2026 à 31/08/2026"],
    [],
    ["Extrato de Reembolso Detalhado"],
    [],
    ["Contrato", "100"],
    [],
    [],
    [],
    ["Lançamentos Efetuados no Período"],
    [],
    [
      "Número do reembolso",
      "Número do contrato",
      "Produto",
      "Data de corte",
      "Data de crédito/débito",
      "Cód. Estabelecimento",
      "Estabelecimento da compra",
      "Data da transação",
      "Data de postagem",
      "Número do documento",
      "Tipo de transação",
      "Descrição do lançamento",
      "Número do cartão",
      "Valor da transação",
      "CNPJ da transação",
    ],
    ["R-1", "C-1", "TRE", "02/08/2026", "10/08/2026", "EC-1", "Empresa Teste", "01/08/2026", "01/08/2026", "DOC-1", "POS", "COMPRA", "****1111", "R$100,00", "00.000.000/0001-00"],
    ["R-1", "C-1", "TRE", "02/08/2026", "10/08/2026", "EC-1", "Empresa Teste", "02/08/2026", "02/08/2026", "DOC-2", "POS", "COMPRA", "****2222", "R$50,00", "00.000.000/0001-00"],
    ["R-1", null, null, null, null, null, null, null, null, null, null, "Subtotal de Vendas", null, "R$150,00"],
    [null, "C-1", null, "02/08/2026", null, null, null, null, null, null, null, "Tarifa de gestão de pagamento", null, "R$9,18"],
    [null, "C-1", null, "02/08/2026", null, null, null, null, null, null, null, "Taxa TPE", null, "R$5,25"],
    [null, null, null, null, null, null, null, null, null, null, null, "Total de Descontos", null, "R$14,43"],
    [null, null, null, null, null, null, null, null, null, null, null, "Valor Líquido", null, "R$135,57"],
    ["R-2", "C-2", "TF", "12/08/2026", "12/08/2026", "EC-1", "Empresa Teste", "11/08/2026", "11/08/2026", "DOC-3", "POS", "COMPRA", "****3333", "R$28,00", "00.000.000/0001-00"],
    ["R-2", null, null, null, null, null, null, null, null, null, null, "Subtotal de Vendas", null, "R$28,00"],
    [null, "C-2", null, "12/08/2026", null, null, null, null, null, null, null, "Tarifa de gestão de pagamento", null, "R$9,18"],
    [null, "C-2", null, "12/08/2026", null, null, null, null, null, null, null, "Tarifa Sobre Adiantamento (Serpar)", null, "R$1,14"],
    [null, "C-2", null, "12/08/2026", null, null, null, null, null, null, null, "Taxa TPE", null, "R$0,98"],
    [null, null, null, null, null, null, null, null, null, null, null, "Total de Descontos", null, "R$11,30"],
    [null, "C-2", null, "12/08/2026", null, null, null, null, null, null, null, "Valor Antecipado", null, "R$16,70"],
    [null, null, null, null, null, null, null, null, null, null, null, "Valor Líquido", null, "R$16,70"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Extrato de Reembolso Detalhado",
  );
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "Extrato_Detalhado_Ticket.xlsx",
  );
}

describe("leitor do Extrato de Reembolso Detalhado da Ticket", () => {
  it("preserva vendas e cada desconto, incluindo antecipação", async () => {
    const result = await parseTicketWorkbook(
      ticketFile(),
      categories,
      "2026-08-31",
      [{
        modality: "VOUCHER",
        installments: 1,
        cardBrand: "Ticket",
        rate: 3.5,
        tolerance: 0.01,
      }],
    );

    expect(result.sourceRows).toBe(3);
    expect(result.lines).toHaveLength(8);
    expect(result.lines.filter((line) => line.eventType === "SALE")).toHaveLength(3);
    expect(result.lines.filter((line) => line.eventType === "FEE")).toHaveLength(4);
    expect(result.lines.filter((line) => line.eventType === "ANTICIPATION")).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      amount: 100,
      paymentDate: "2026-08-10",
      acquirer: "TICKET",
      transactionType: "VOUCHER",
      rateValidation: "MATCH",
    });
    expect(result.sourceTotals).toEqual({
      rows: 3,
      gross: 178,
      fees: 25.73,
      net: 152.27,
    });
  });

  it("detecta Ticket automaticamente", async () => {
    const result = await parseAcquirerWorkbook(
      ticketFile(),
      categories,
      "2026-08-31",
      [],
    );

    expect(result.acquirer).toBe("TICKET");
    expect(result.parserId).toBe("ticket-extrato-reembolso-detalhado");
  });
});
