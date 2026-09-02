import { describe, expect, it } from "vitest";
import {
  buildFinancialEventPayload,
  findContaAzulOption,
  installmentIdFrom,
  protocolIdFrom,
  protocolState,
  resourceIdFromProtocol,
} from "./financial-export";

describe("envio financeiro direto ao Conta Azul", () => {
  it("localiza categorias ignorando acentos, caixa e hierarquia interna", () => {
    const options = [
      { value: "category-1", label: "Taxas de antecipação" },
      { value: "category-2", label: "Sistemas e softwares" },
    ];
    expect(findContaAzulOption(options, "TAXAS DE ANTECIPACAO")?.value).toBe("category-1");
    expect(findContaAzulOption(options, "DESPESAS > Sistemas e Softwares")?.value).toBe("category-2");
  });

  it("não mistura categorias de receita e despesa com o mesmo nome", () => {
    const options = [
      { value: "income", label: "Taxas", type: "RECEITA" as const },
      { value: "expense", label: "Taxas", type: "DESPESA" as const },
    ];

    expect(findContaAzulOption(options, "Taxas", "RECEITA")?.value).toBe("income");
    expect(findContaAzulOption(options, "Taxas", "DESPESA")?.value).toBe("expense");
  });

  it("mantém um lançamento e seu rateio em uma única linha financeira", () => {
    const payload = buildFinancialEventPayload({
      direction: "PAYABLE",
      competenceDate: "2026-08-10",
      dueDate: "2026-08-20",
      description: "Taxa MDR Visa",
      observation: "Linha da planilha",
      amount: -12.349,
      contactId: "contact-id",
      financialAccountId: "account-id",
      categoryId: "category-id",
      costCenterId: "cost-center-id",
    });
    expect(payload.valor).toBe(12.35);
    expect(payload.rateio).toEqual([{
      id_categoria: "category-id",
      valor: 12.35,
      rateio_centro_custo: [{ id_centro_custo: "cost-center-id", valor: 12.35 }],
    }]);
    expect(payload.condicao_pagamento.parcelas).toHaveLength(1);
  });

  it("interpreta protocolo, recurso e parcela nas formas aceitas pela API", () => {
    const eventId = "35473eec-4e74-11ee-b500-9f61de8a8b8b";
    expect(protocolIdFrom({ protocolId: "protocol-1" })).toBe("protocol-1");
    expect(protocolState({ status: "SUCCESS" })).toBe("SUCCESS");
    expect(resourceIdFromProtocol({ status: "SUCCESS", data: { id: eventId } })).toBe(eventId);
    expect(installmentIdFrom([{ id: eventId }])).toBe(eventId);
  });
});
