import { extractPdfLines } from "./pdf-reader.client";
import {
  extractInterInvoiceImageLines,
  isCardInvoiceImage,
  parseCardInvoiceImages,
} from "./image-reader.client";
import { parseBancoDoBrasilInvoice } from "./parsers/banco-do-brasil-parser";
import { parseInterInvoice } from "./parsers/inter-parser";
import { parseBradescoInvoice } from "./parsers/bradesco-parser";
import { parseItauInvoice } from "./parsers/itau-parser";
import { parseSicoobInvoice } from "./parsers/sicoob-parser";
import { parseSantanderInvoice } from "./parsers/santander-parser";
import { parseCaixaInvoice } from "./parsers/caixa-parser";
import { parseBtgInvoice } from "./parsers/btg-parser";
import { parseSicrediInvoice } from "./parsers/sicredi-parser";
import type { ParsedInvoice } from "./types";

export async function parseCardInvoice(
  file: File,
  bank: string,
  password?: string,
): Promise<ParsedInvoice> {
  const normalized = bank
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (isCardInvoiceImage(file)) {
    if (normalized.includes("INTER")) {
      try {
        const imageResult = await extractInterInvoiceImageLines(file);
        const parsed = parseInterInvoice(imageResult.lines);
        if (parsed.items.length) {
          return {
            ...parsed,
            invoiceTotal: Number(
              parsed.items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
            ),
            warnings: [...imageResult.warnings, ...parsed.warnings],
          };
        }
      } catch {
        // O leitor genérico abaixo cobre prints recortados e layouts móveis.
      }
    }
    if (normalized.includes("SICOOB")) {
      try {
        return await parseSicoobInvoice(file, password);
      } catch {
        // Um print parcial não tem todas as seções esperadas pelo leitor dedicado.
      }
    }
    return parseCardInvoiceImages([file], bank);
  }

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Selecione uma fatura em PDF, PNG, JPG, JPEG ou WebP.");
  }

  if (normalized.includes("CORA")) {
    throw new Error(
      "O leitor do Cora aceita imagens. Envie um ou mais prints em PNG, JPG, JPEG ou WebP.",
    );
  }

  const lines = await extractPdfLines(file, password);

  if (normalized.includes("SICOOB")) {
    return parseSicoobInvoice(file, password);
  }

  if (normalized.includes("INTER")) {
    return parseInterInvoice(lines);
  }

  if (normalized.includes("BRADESCO")) {
    return parseBradescoInvoice(lines);
  }

  if (normalized.includes("BANCO DO BRASIL")) {
    return parseBancoDoBrasilInvoice(lines);
  }

  if (normalized.includes("ITAU")) {
    return parseItauInvoice(lines);
  }

  if (normalized.includes("SANTANDER")) {
    return parseSantanderInvoice(lines);
  }

  if (normalized.includes("CAIXA")) {
    return parseCaixaInvoice(lines);
  }

  if (normalized.includes("BTG")) {
    return parseBtgInvoice(lines);
  }

  if (normalized.includes("SICREDI")) {
    return parseSicrediInvoice(lines);
  }

  throw new Error(`O parser de ${bank} ainda não foi implementado.`);
}

export async function parseCardInvoiceFiles(
  files: File[],
  bank: string,
  password?: string,
): Promise<ParsedInvoice> {
  if (!files.length) throw new Error("Selecione ao menos um arquivo.");
  if (files.length === 1) return parseCardInvoice(files[0], bank, password);
  if (files.some((file) => !isCardInvoiceImage(file))) {
    throw new Error(
      "Para combinar vários arquivos, selecione somente imagens. PDFs devem ser enviados individualmente.",
    );
  }
  return parseCardInvoiceImages(files, bank);
}
