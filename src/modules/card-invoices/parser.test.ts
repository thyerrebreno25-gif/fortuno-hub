import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedInvoice } from "./types";

const reader = vi.hoisted(() => ({
  extractInterInvoiceImageLines: vi.fn(),
  parseCardInvoiceImages: vi.fn(),
}));
const inter = vi.hoisted(() => ({
  parseInterInvoice: vi.fn(),
}));

vi.mock("./image-reader.client", () => ({
  extractInterInvoiceImageLines: reader.extractInterInvoiceImageLines,
  isCardInvoiceImage: () => true,
  parseCardInvoiceImages: reader.parseCardInvoiceImages,
}));

vi.mock("./parsers/inter-parser", () => ({
  parseInterInvoice: inter.parseInterInvoice,
}));

import { parseCardInvoiceFiles } from "./parser";

function parsedPage(
  items: ParsedInvoice["items"],
): ParsedInvoice {
  return {
    bank: "INTER",
    invoiceTotal: items.reduce((sum, item) => sum + item.amount, 0),
    dueDate: "2026-08-10",
    items,
    warnings: [],
  };
}

function item(id: number, date: string, description: string, amount: number) {
  return {
    id,
    date,
    description,
    amount,
    transactionType: "PURCHASE" as const,
    exportable: true,
  };
}

describe("seleção do leitor para arquivos de fatura", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reader.extractInterInvoiceImageLines.mockImplementation(async (file: File) => ({
      lines: [{ page: 1, y: 1000, text: file.name }],
      warnings: [],
    }));
    inter.parseInterInvoice.mockImplementation((lines: Array<{ text: string }>) =>
      lines[0].text === "parte-1.png"
        ? parsedPage([
            item(1, "2026-08-01", "LOJA A", 10),
            item(2, "2026-08-02", "LOJA B", 20),
          ])
        : parsedPage([
            item(1, "2026-08-02", "LOJA B", 20),
            item(2, "2026-08-03", "LOJA C", 30),
          ]),
    );
  });

  it("mantém o leitor específico do Inter ao combinar vários prints", async () => {
    const files = [
      { name: "parte-1.png", type: "image/png" },
      { name: "parte-2.png", type: "image/png" },
    ] as File[];

    const result = await parseCardInvoiceFiles(files, "Banco Inter");

    expect(reader.extractInterInvoiceImageLines).toHaveBeenCalledTimes(2);
    expect(reader.parseCardInvoiceImages).not.toHaveBeenCalled();
    expect(result.items.map((current) => current.description)).toEqual([
      "LOJA A",
      "LOJA B",
      "LOJA C",
    ]);
    expect(result.invoiceTotal).toBe(60);
    expect(result.warnings.join(" ")).toContain("1 lançamento(s) repetido(s)");
  });
});
