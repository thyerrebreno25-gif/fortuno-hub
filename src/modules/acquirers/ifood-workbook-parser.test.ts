import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  isIfoodReconciliationSheet,
  parseIfoodWorkbook,
} from "./ifood-workbook-parser";
import {
  buildContaAzulAcquirerObservation,
  contaAzulAcquirerDescription,
} from "./conta-azul-exporter";
import { parseAcquirerWorkbook } from "./parse-acquirer-workbook";

const categories = {
  sale: "Receita de cartões",
  fee: "Taxas de adquirentes",
  adjustment: "Ajustes financeiros",
  cancellation: "Cancelamentos",
  chargeback: "Chargeback",
  anticipation: "Antecipação",
};

const headers = [
  "competencia",
  "fato_gerador",
  "tipo_lancamento",
  "descricao_lancamento",
  "valor",
  "base_calculo",
  "percentual_taxa",
  "pedido_associado_ifood",
  "pedido_associado_ifood_curto",
  "motivo_cancelamento",
  "descricao_ocorrencia",
  "data_criacao_pedido_associado",
  "data_repasse_esperada",
  "valor_transacao",
  "loja_id",
  "loja_id_curto",
  "cnpj",
  "data_faturamento",
  "data_apuracao_inicio",
  "data_apuracao_fim",
  "valor_cesta_final",
  "responsavel_transacao",
  "canal_vendas",
  "impacto_no_repasse",
  "pedido_detalhes",
  "id_saldo",
  "metodo_pagamento",
  "bandeira_pagamento",
];

function row({
  type,
  description,
  amount,
  creation,
  payment,
  declared,
  order,
  balance,
  periodStart,
  periodEnd,
}: {
  type: string;
  description: string;
  amount: number;
  creation: string;
  payment: string;
  declared: number;
  order: string;
  balance: string;
  periodStart: string;
  periodEnd: string;
}) {
  return [
    "2026-07",
    "Venda",
    type,
    description,
    amount,
    100,
    0,
    `uuid-${order}`,
    order,
    "",
    "",
    creation,
    payment,
    declared,
    "loja-uuid",
    "123456",
    "00000000000100",
    creation,
    periodStart,
    periodEnd,
    100,
    "IFOOD",
    "iFood",
    "SIM",
    "",
    balance,
    "Crédito",
    "VISA",
  ];
}

function ifoodFile() {
  const rows = [
    headers,
    row({
      type: "Entrada Financeira",
      description: "Entrada Financeira",
      amount: 100,
      creation: "2026-07-01T12:27:29.200481Z",
      payment: "2026-07-29",
      declared: 90,
      order: "4305",
      balance: "saldo-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-05",
    }),
    row({
      type: "Cobrança",
      description: "Comissão do iFood",
      amount: -20,
      creation: "2026-07-01T12:27:29.200481Z",
      payment: "2026-07-29",
      declared: 90,
      order: "4305",
      balance: "saldo-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-05",
    }),
    row({
      type: "Subsídio",
      description: "Promoção custeada pelo iFood",
      amount: 10,
      creation: "2026-07-01T12:27:29.200481Z",
      payment: "2026-07-29",
      declared: 90,
      order: "4305",
      balance: "saldo-1",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-05",
    }),
    row({
      type: "Entrada Financeira",
      description: "Entrada Financeira",
      amount: 50,
      creation: "2026-07-06T18:00:00Z",
      payment: "2026-08-05",
      declared: 45,
      order: "6209",
      balance: "saldo-2",
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
    }),
    row({
      type: "Retenção",
      description: "Taxa de serviço iFood cobrada do cliente",
      amount: -5,
      creation: "2026-07-06T18:00:00Z",
      payment: "2026-08-05",
      declared: 45,
      order: "6209",
      balance: "saldo-2",
      periodStart: "2026-07-06",
      periodEnd: "2026-07-12",
    }),
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    "Relatório de Conciliação",
  );
  return new File(
    [XLSX.write(workbook, { type: "array", bookType: "xlsx" })],
    "relatorio-ifood.xlsx",
  );
}

describe("leitor do relatório de conciliação do iFood", () => {
  it("reconhece o cabeçalho específico", () => {
    expect(isIfoodReconciliationSheet([headers])).toBe(true);
  });

  it("preserva cada lançamento e extrai somente a data da competência", async () => {
    const result = await parseIfoodWorkbook(
      ifoodFile(),
      categories,
      "2026-07-29",
    );

    expect(result.sourceRows).toBe(5);
    expect(result.lines).toHaveLength(5);
    expect(result.lines[0]).toMatchObject({
      eventType: "SALE",
      saleDate: "2026-07-01",
      paymentDate: "2026-07-29",
      amount: 100,
      acquirer: "IFOOD",
      transactionType: "CREDIT",
      cardBrand: "Visa",
    });
    expect(result.lines[1]).toMatchObject({
      eventType: "FEE",
      amount: -20,
      feeCategory: "SALE_FEE",
    });
    expect(result.lines[2]).toMatchObject({
      eventType: "ADJUSTMENT",
      amount: 10,
    });
    expect(contaAzulAcquirerDescription(result.lines[1])).toBe(
      "IFOOD - Comissão do iFood - pedido 4305",
    );
    expect(buildContaAzulAcquirerObservation(result.lines[1])).toContain(
      "Pedido iFood: 4305",
    );
    expect(result.sourceTotals).toEqual({
      rows: 5,
      gross: 150,
      fees: 25,
      net: 135,
    });
  });

  it("entrega os períodos agrupados pelas datas disponíveis para filtro", async () => {
    const result = await parseIfoodWorkbook(
      ifoodFile(),
      categories,
      "2026-07-29",
    );

    expect(result.paymentBatches).toEqual([
      {
        paymentDate: "2026-07-29",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-05",
        sourceRows: 3,
        gross: 100,
        fees: 20,
        adjustments: 10,
        cancellations: 0,
        net: 90,
        declaredNet: 90,
        difference: 0,
      },
      {
        paymentDate: "2026-08-05",
        periodStart: "2026-07-06",
        periodEnd: "2026-07-12",
        sourceRows: 2,
        gross: 50,
        fees: 5,
        adjustments: 0,
        cancellations: 0,
        net: 45,
        declaredNet: 45,
        difference: 0,
      },
    ]);
  });

  it("detecta iFood automaticamente", async () => {
    const result = await parseAcquirerWorkbook(
      ifoodFile(),
      categories,
      "2026-07-29",
      [],
    );

    expect(result.acquirer).toBe("IFOOD");
    expect(result.parserId).toBe("ifood-relatorio-conciliacao");
    expect(result.paymentBatches).toHaveLength(2);
  });
});
