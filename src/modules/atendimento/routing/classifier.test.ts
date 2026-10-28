import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  findMember: vi.fn(),
  findClients: vi.fn(),
  findIdentities: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organizationMember: { findFirst: database.findMember },
    client: { findMany: database.findClients },
    clientEmailIdentity: { findMany: database.findIdentities },
  },
}));

import { classifyAndRouteEmail } from "./classifier";

const abismoClient = {
  id: "client-abismo",
  name: "Abismo Anhumas",
  document: "12345678000190",
  operationalEmail: null,
  operationalEmailCc: null,
  operationLeaderId: "user-leader",
  serviceSquad: "SQUAD_2" as const,
  payableResponsibleId: "user-ap",
  receivableResponsibleId: "user-ar",
  generalResponsibleId: "user-general",
  serviceAliases: "Abismo; Anhumas Turismo",
};

describe("classificação e roteamento do Atendimento", () => {
  beforeEach(() => {
    database.findMember.mockResolvedValue({ userId: "member" });
    database.findClients.mockReset();
    database.findIdentities.mockReset();
    database.findIdentities.mockResolvedValue([]);
  });

  it("identifica o cliente no conteúdo e direciona boleto ao responsável AP", async () => {
    database.findClients.mockResolvedValue([abismoClient]);

    const decision = await classifyAndRouteEmail({
      organizationId: "org-1",
      senderEmail: "cobranca@fornecedor.com.br",
      subject: "Boleto referente à unidade Abismo Anhumas",
      textBody:
        "Segue boleto dos serviços prestados para ABISMO ANHUMAS LTDA.",
      attachmentNames: ["boleto_abismo_agosto.pdf"],
    });

    expect(decision.clientId).toBe("client-abismo");
    expect(decision.area).toBe("ACCOUNTS_PAYABLE");
    expect(decision.assignedToId).toBe("user-ap");
    expect(decision.squad).toBe("SQUAD_2");
    expect(decision.isSpam).toBe(false);
  });

  it("move propaganda clara e sem cliente identificado para Spam", async () => {
    database.findClients.mockResolvedValue([]);

    const decision = await classifyAndRouteEmail({
      organizationId: "org-1",
      senderEmail: "marketing@loja-promocional.com.br",
      subject: "Oferta imperdível: cupom de desconto exclusivo",
      textBody:
        "Confira nossa newsletter, compre agora com frete grátis ou descadastre-se.",
    });

    expect(decision.clientId).toBeNull();
    expect(decision.assignedToId).toBeNull();
    expect(decision.isSpam).toBe(true);
    expect(decision.spamScore).toBeGreaterThanOrEqual(80);
  });

  it("mantém mensagem financeira fora do Spam mesmo com rodapé comercial", async () => {
    database.findClients.mockResolvedValue([]);

    const decision = await classifyAndRouteEmail({
      organizationId: "org-1",
      senderEmail: "financeiro@fornecedor.com.br",
      subject: "Boleto e nota fiscal para pagamento",
      textBody:
        "Segue a fatura com vencimento amanhã. Newsletter: descadastre-se.",
    });

    expect(decision.area).toBe("ACCOUNTS_PAYABLE");
    expect(decision.isSpam).toBe(false);
    expect(decision.assignedToId).toBeNull();
  });
  it("routes issued invoices to receivables even when a boleto is mentioned", async () => {
    database.findClients.mockResolvedValue([abismoClient]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "financeiro@cliente.com", subject: "Abismo Anhumas: boleto emitido para cobrar cliente", textBody: "Segue nota fiscal emitida e boleto para recebimento." });
    expect(result.clientId).toBe(abismoClient.id); expect(result.area).toBe("ACCOUNTS_RECEIVABLE"); expect(result.assignedToId).toBe("user-ar");
  });
  it("keeps ambiguous payable/receivable matters unassigned for review", async () => {
    database.findClients.mockResolvedValue([abismoClient]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "contato@test.com", subject: "Abismo Anhumas", textBody: "Contas a pagar e contas a receber." });
    expect(result.area).toBe("UNKNOWN"); expect(result.assignedToId).toBeNull(); expect(result.isSpam).toBe(false);
  });
  it("does not concatenate unrelated numbers into a client's CNPJ", async () => {
    database.findClients.mockResolvedValue([abismoClient]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "contato@test.com", subject: "Comunicado", textBody: "Pedido 12345678. Código de acesso 000190." });
    expect(result.clientId).toBeNull();
  });
  it("does not choose between equally matching companies", async () => {
    database.findClients.mockResolvedValue([abismoClient, { ...abismoClient, id: "other" }]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "contato@test.com", subject: "Abismo Anhumas: boleto", textBody: "Pagamento" });
    expect(result.clientId).toBeNull(); expect(result.assignedToId).toBeNull();
  });
  it("ignores collection platform advertising when routing a vendor invoice", async () => {
    database.findClients.mockResolvedValue([abismoClient]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "financeiro@fornecedor.com", subject: "Abismo Anhumas: seu vencimento é hoje", textBody: "Lembrete sobre o vencimento de um título dos serviços prestados. Construído por IRecebi - Uma plataforma completa para o engajamento de contas a receber e cobrança.", attachmentNames: ["BOLETO_RPS_42910.pdf"] });
    expect(result.area).toBe("ACCOUNTS_PAYABLE");
    expect(result.assignedToId).toBe("user-ap");
  });
  it("does not treat acknowledgment of an email as a financial receipt", async () => {
    database.findClients.mockResolvedValue([abismoClient]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "contato@test.com", subject: "Abismo Anhumas: documentos", textBody: "Por favor, confirmar o recebimento deste e-mail. Preciso receber a documentação." });
    expect(result.area).toBe("GENERAL");
    expect(result.assignedToId).toBe("user-general");
  });
  it("ignores a quoted old client conversation", async () => {
    database.findClients.mockResolvedValue([abismoClient]);
    const result = await classifyAndRouteEmail({ organizationId: "org-1", senderEmail: "contato@test.com", subject: "Outra demanda", textBody: "Vamos conversar amanhã.\n> Abismo Anhumas: contas a pagar" });
    expect(result.clientId).toBeNull();
  });
});
