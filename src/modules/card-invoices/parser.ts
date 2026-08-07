import { extractPdfLines } from "./pdf-reader.client";
import { parseInterInvoice } from "./parsers/inter-parser";
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

  const lines = await extractPdfLines(file, password);

  if (normalized.includes("INTER")) {
    return parseInterInvoice(lines);
  }

  throw new Error(`O parser de ${bank} ainda não foi implementado.`);
}