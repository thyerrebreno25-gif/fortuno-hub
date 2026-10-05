import { describe, expect, it } from "vitest";
import {
  average,
  normalizeWhatsappIdentity,
  responsibleForRoutingArea,
  whatsappChannelAddress,
} from "./core";

describe("WhatsApp routing", () => {
  const client = {
    operationLeaderId: "leader",
    payableResponsibleId: "payable",
    receivableResponsibleId: "receivable",
    generalResponsibleId: "general",
  };

  it("routes each financial topic to the configured responsible", () => {
    expect(responsibleForRoutingArea(client, "ACCOUNTS_PAYABLE")).toBe(
      "payable",
    );
    expect(responsibleForRoutingArea(client, "ACCOUNTS_RECEIVABLE")).toBe(
      "receivable",
    );
    expect(responsibleForRoutingArea(client, "GENERAL")).toBe("general");
  });

  it("normalizes contacts and groups into stable channel addresses", () => {
    expect(normalizeWhatsappIdentity("CONTACT", "+55 (62) 99999-0000")).toBe(
      "5562999990000",
    );
    expect(normalizeWhatsappIdentity("GROUP", "Grupo Cliente XP")).toBe(
      "grupo-cliente-xp",
    );
    expect(whatsappChannelAddress("GROUP", "grupo-xp")).toBe(
      "wa-group:grupo-xp",
    );
  });

  it("calculates a rounded average while ignoring missing values", () => {
    expect(average([10, 20, null, undefined])).toBe(15);
  });
});
