import { describe, expect, it } from "vitest";
import {
  buildAcquirerComparison,
  identifyPrimaryAcquirer,
} from "./acquirer-comparison";

describe("comparativo das adquirentes principais", () => {
  it("reconhece as quatro adquirentes principais e ignora as secundárias", () => {
    expect(identifyPrimaryAcquirer("Cielo")).toBe("CIELO");
    expect(identifyPrimaryAcquirer("Get Net")).toBe("GETNET");
    expect(identifyPrimaryAcquirer("RedeCard")).toBe("REDE");
    expect(identifyPrimaryAcquirer("Pagar.me")).toBe("PAGARME");
    expect(identifyPrimaryAcquirer("iFood")).toBeNull();
  });

  it("mostra quem paga menos, quem paga mais e a diferença", () => {
    const result = buildAcquirerComparison([
      {
        clientId: "cliente-x",
        clientName: "Cliente X",
        acquirerName: "Cielo",
        rates: [1.5, 2.5],
      },
      {
        clientId: "cliente-y",
        clientName: "Cliente Y",
        acquirerName: "Cielo",
        rates: [2.5, 3.5],
      },
      {
        clientId: "cliente-z",
        clientName: "Cliente Z",
        acquirerName: "GoodCard",
        rates: [1],
      },
    ]);

    expect(result[0]).toMatchObject({
      acquirer: "CIELO",
      clientsCount: 2,
      bestClientName: "Cliente X",
      highestClientName: "Cliente Y",
      bestRate: 2,
      highestRate: 3,
      spread: 1,
    });
    expect(result[0].clients[1].deltaFromBest).toBe(1);
    expect(result.find((item) => item.acquirer === "GETNET")?.clients).toEqual([]);
  });
});
