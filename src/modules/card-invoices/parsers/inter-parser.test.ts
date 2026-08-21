import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { parseInterInvoice } from "./inter-parser";

function lines(values: string[]): PdfTextLine[] {
  return values.map((text, index) => ({ page: 1, y: 1000 - index, text }));
}

describe("leitor de fatura do Banco Inter", () => {
  it("estrutura uma captura de tela, ignora o pagamento e confere o total", () => {
    const source = lines([
      "Fatura",
      "Vencimento: 10/09",
      "Fatura fechada total: R$ (-) R$ 4.693,68",
      "Despesas da fatura",
      "19 de ago 2026 PPRO ADOBE SAO PAULO BRA - R$ 14,00",
      "19 de ago 2026 EBN ADOBE CURITIBA BRA - R$ 55,00",
      "17 de ago 2026 DL UberRides Sao Paulo BRA - R$ 27,27",
      "13 de ago 2026 DL UberRides Sao Paulo BRA - R$ 30,99",
      "12 de ago 2026 DL UberRides Sao Paulo BRA - R$ 24,99",
      "11 de ago 2026 Vindi Kinghost Porto Alegre BRA - R$ 1.486,80",
      "11 de ago 2026 UBER TRIP OSASCO BRA - R$ 17,98",
      "11 de ago 2026 DL UberRides Sao Paulo BRA - R$ 13,98",
      "11 de ago 2026 DL UberRides Sao Paulo BRA - R$ 12,95",
      "10 de ago 2026 APPLE COM BILL SAO PAULO BRA - R$ 187,90",
      "10 de ago 2026 APPLE COM BILL SAO PAULO BRA - R$ 129,90",
      "10 de ago 2026 PAGTO DEBITO AUTOMATICO +R$ 3.013,96",
      "09 de ago 2026 IOF INTERNACIONAL - R$ 82,12",
      "07 de ago 2026 SURVEY MONKE 47690540 SAO PAULO BRA - R$ 93,00",
      "07 de ago 2026 ANTHROPIC CLAUDE TEAM SAN FRANCISCO CA - R$ 2.346,25",
      "06 de ago 2026 DL UberRides Sao Paulo BRA - R$ 21,98",
      "04 de ago 2026 CLICKSIGN Clicksign SAO PAULO BRA - R$ 39,00",
      "04 de ago 2026 IOF INTERNACIONAL - R$ 3,71",
      "03 de ago 2026 GENSPARK AI PALO ALTO CA - R$ 105,86",
    ]);

    const result = parseInterInvoice(source);

    expect(result.items).toHaveLength(18);
    expect(result.items.some((item) => item.description.includes("PAGTO DEBITO"))).toBe(false);
    expect(result.invoiceTotal).toBe(4693.68);
    expect(result.dueDate).toBe("2026-09-10");
    expect(result.items.reduce((total, item) => total + item.amount, 0)).toBeCloseTo(4693.68, 2);
    expect(result.warnings).toEqual([]);
  });
});
