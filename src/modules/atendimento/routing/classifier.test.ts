import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  findClients: vi.fn(),
  findIdentities: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
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
});
