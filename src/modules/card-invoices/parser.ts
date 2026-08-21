import { extractPdfLines } from "./pdf-reader.client";
import {
  extractInterInvoiceImageLines,
  isCardInvoiceImage,
} from "./image-reader.client";
import { parseBancoDoBrasilInvoice } from "./parsers/banco-do-brasil-parser";
import { parseInterInvoice } from "./parsers/inter-parser";
import { parseBradescoInvoice } from "./parsers/bradesco-parser";
import { parseSicoobInvoice } from "./parsers/sicoob-parser";
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

  /*
   * Sicoob é um layout por imagem. Ele precisa receber o File original
   * para renderizar a página e fazer OCR no parser dedicado.
   *
   * Os demais bancos continuam exatamente no fluxo atual por PdfTextLine[].
   */
  if (normalized.includes("SICOOB")) {
    return parseSicoobInvoice(file, password);
  }

  if (isCardInvoiceImage(file)) {
    if (normalized.includes("INTER")) {
      const imageResult = await extractInterInvoiceImageLines(file);
      const parsed = parseInterInvoice(imageResult.lines);
      return {
        ...parsed,
        warnings: [...imageResult.warnings, ...parsed.warnings],
      };
    }
    throw new Error(`A leitura de imagem para ${bank} ainda não foi implementada.`);
  }

  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("Selecione uma fatura em PDF, PNG, JPG, JPEG ou WebP.");
  }

  const lines = await extractPdfLines(file, password);

  if (normalized.includes("INTER")) {
    return parseInterInvoice(lines);
  }

  if (normalized.includes("BRADESCO")) {
    return parseBradescoInvoice(lines);
  }

  if (normalized.includes("BANCO DO BRASIL")) {
    return parseBancoDoBrasilInvoice(lines);
  }

  throw new Error(`O parser de ${bank} ainda não foi implementado.`);
}
