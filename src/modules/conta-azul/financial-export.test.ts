import { describe, expect, it } from "vitest";
import {
  automaticFinancialContactName,
  buildDirectFinancialEventPayload,
  buildFinancialEventPayload,
  contaAzulOptions,
  financialEventIdFromCreation,
  findContaAzulOption,
  installmentIdFrom,
  installmentIdFromCreation,
  protocolIdFrom,
  protocolState,
  requiredContactProfiles,
  resourceIdFromProtocol,
  technicalContactProfileSuffix,
} from "./financial-export";

describe("envio financeiro direto ao Conta Azul", () => {
  it("exige apenas os perfis necessários para cada direção financeira", () => {
    expect(requiredContactProfiles(["PAYABLE", "PAYABLE"]))
      .toEqual(["Fornecedor"]);
    expect(requiredContactProfiles(["RECEIVABLE"]))
      .toEqual(["Cliente"]);
    expect(requiredContactProfiles(["PAYABLE", "RECEIVABLE"]))
      .toEqual(["Cliente", "Fornecedor"]);
    expect(technicalContactProfileSuffix(["Fornecedor"]))
      .toBe("DESPESAS");
    expect(technicalContactProfileSuffix(["Cliente"]))
      .toBe("RECEITAS");
    expect(technicalContactProfileSuffix(["Cliente", "Fornecedor"]))
      .toBe("FINANCEIRO");
    expect(automaticFinancialContactName(["Fornecedor"]))
      .toBe("LANÇAMENTO AUTOMÁTICO");
    expect(automaticFinancialContactName(["Cliente"]))
      .toBe("LANÇAMENTO AUTOMÁTICO - RECEITAS");
  });

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

  it("interpreta também uma pessoa criada devolvida como objeto único", () => {
    expect(contaAzulOptions({
      id: "35473eec-4e74-11ee-b500-9f61de8a8b8b",
      nome: "REDE",
    })).toEqual([{
      value: "35473eec-4e74-11ee-b500-9f61de8a8b8b",
      label: "REDE",
    }]);
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

  it("monta o contrato síncrono novo com fornecedor/cliente e referência externa", () => {
    const base = {
      competenceDate: "2026-10-01",
      dueDate: "2026-10-10",
      description: "Linha teste",
      observation: "Criada pelo Fortuno Hub",
      amount: 25,
      contactId: "contact-id",
      financialAccountId: "account-id",
      categoryId: "category-id",
      externalReference: "FORTUNO-line-1",
    };
    const payable = buildDirectFinancialEventPayload({ ...base, direction: "PAYABLE" });
    const receivable = buildDirectFinancialEventPayload({ ...base, direction: "RECEIVABLE" });
    expect(payable).toMatchObject({ id_fornecedor: "contact-id", referencia_externa: "FORTUNO-line-1" });
    expect(receivable).toMatchObject({ id_cliente: "contact-id", referencia_externa: "FORTUNO-line-1" });
    expect(payable).not.toHaveProperty("contato");
    expect(receivable).not.toHaveProperty("contato");
  });

  it("interpreta protocolo, recurso e parcela nas formas aceitas pela API", () => {
    const eventId = "35473eec-4e74-11ee-b500-9f61de8a8b8b";
    const protocolId = "145fbbc7-5125-4cc4-be15-11cd04d84fa0";
    expect(protocolIdFrom({ protocolId: "protocol-1" })).toBe("protocol-1");
    expect(protocolState({ status: "SUCCESS" })).toBe("SUCCESS");
    expect(resourceIdFromProtocol({ status: "SUCCESS", data: { id: eventId } })).toBe(eventId);
    expect(resourceIdFromProtocol({
      id: protocolId,
      status: "SUCCESS",
      resposta: "O evento financeiro foi criado no contas a pagar da Conta Azul.",
      evento_financeiro_id: eventId,
    })).toBe(eventId);
    expect(installmentIdFrom([{ id: eventId }])).toBe(eventId);
    expect(financialEventIdFromCreation({ id: eventId, condicao_pagamento: { parcelas: [{ id: protocolId }] } })).toBe(eventId);
    expect(installmentIdFromCreation({ id: eventId, condicao_pagamento: { parcelas: [{ id: protocolId }] } })).toBe(protocolId);
  });
});
