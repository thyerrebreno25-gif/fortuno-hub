import { describe, expect, it } from "vitest";
import {
  cardInvoiceImageScale,
  isReadableCardInvoiceImageSize,
} from "./image-reader.client";

describe("preparação das imagens de fatura", () => {
  it("aceita recortes horizontais largos com poucas linhas", () => {
    expect(isReadableCardInvoiceImageSize(1519, 75)).toBe(true);
    expect(isReadableCardInvoiceImageSize(1529, 116)).toBe(true);
  });

  it("continua rejeitando imagens sem resolução útil", () => {
    expect(isReadableCardInvoiceImageSize(320, 200)).toBe(false);
    expect(isReadableCardInvoiceImageSize(1000, 40)).toBe(false);
  });

  it("amplia recortes baixos para preservar a legibilidade do texto", () => {
    expect(cardInvoiceImageScale(1519, 75)).toBe(4);
    expect(cardInvoiceImageScale(1519, 299)).toBeGreaterThanOrEqual(3);
    expect(cardInvoiceImageScale(1528, 763)).toBeCloseTo(3000 / 1528);
  });
});
