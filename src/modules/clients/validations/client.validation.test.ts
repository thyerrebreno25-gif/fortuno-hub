import { describe, expect, it } from "vitest";
import {
  ClientValidationError,
  validateCreateClientPayload,
} from "./client.validation";

const basePayload = {
  name: "Cliente de teste",
  document: "11.222.333/0001-81",
  acquirers: [],
  categoryMappings: [],
};

describe("cadastro de cliente com equipe", () => {
  it("preserva os dados opcionais de equipe e roteamento", () => {
    const result = validateCreateClientPayload({
      ...basePayload,
      serviceSquad: "SQUAD_2",
      operationLeaderId: "user-leader",
      payableResponsibleId: "user-ap",
      receivableResponsibleId: "user-ar",
      generalResponsibleId: "user-general",
      serviceAliases: "Nome fantasia\nNome abreviado",
    });

    expect(result.serviceSquad).toBe("SQUAD_2");
    expect(result.operationLeaderId).toBe("user-leader");
    expect(result.payableResponsibleId).toBe("user-ap");
    expect(result.receivableResponsibleId).toBe("user-ar");
    expect(result.generalResponsibleId).toBe("user-general");
    expect(result.serviceAliases).toBe(
      "Nome fantasia\nNome abreviado",
    );
  });

  it("continua permitindo criar o cliente sem equipe definida", () => {
    const result = validateCreateClientPayload(basePayload);

    expect(result.serviceSquad).toBeNull();
    expect(result.operationLeaderId).toBeNull();
    expect(result.payableResponsibleId).toBeNull();
    expect(result.receivableResponsibleId).toBeNull();
    expect(result.generalResponsibleId).toBeNull();
  });

  it("recusa uma equipe desconhecida", () => {
    expect(() =>
      validateCreateClientPayload({
        ...basePayload,
        serviceSquad: "SQUAD_INVALIDO",
      }),
    ).toThrow(ClientValidationError);
  });
});
