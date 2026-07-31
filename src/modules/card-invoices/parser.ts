import { extractPdfLines } from "./pdf-reader.client";
import { parseInterInvoice } from "./parsers/inter-parser";
import type { ParsedInvoice } from "./types";

export async function parseCardInvoice(file: File, bank: string, password?: string): Promise<ParsedInvoice> {
  const lines = await extractPdfLines(file, password);
  const normalized = bank.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (normalized.includes("INTER")) return parseInterInvoice(lines);
  throw new Error(`O parser de ${bank} ainda não foi implementado. Para este teste, selecione Banco Inter.`);
}
