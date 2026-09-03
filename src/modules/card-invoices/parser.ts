import { extractPdfLines } from "./pdf-reader.client";
import {
  extractInterInvoiceImageLines,
  isCardInvoiceImage,
  parseCardInvoiceImages,
} from "./image-reader.client";
import { deduplicateOverlappingImageItems } from "./image-transactions";
import { parseBancoDoBrasilInvoice } from "./parsers/banco-do-brasil-parser";
import { parseInterInvoice } from "./parsers/inter-parser";
import { parseBradescoInvoice } from "./parsers/bradesco-parser";
import { parseItauInvoice } from "./parsers/itau-parser";
import { parseSicoobInvoice } from "./parsers/sicoob-parser";
import { parseSantanderInvoice } from "./parsers/santander-parser";
import { parseCaixaInvoice } from "./parsers/caixa-parser";
import { parseBtgInvoice } from "./parsers/btg-parser";
import { parseSicrediInvoice } from "./parsers/sicredi-parser";
import { parseNubankInvoice } from "./parsers/nubank-parser";
import type { ParsedInvoice } from "./types";

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function parseMultipleInterInvoiceImages(
  files: File[],
  bank: string,
): Promise<ParsedInvoice> {
  const parsedPages: ParsedInvoice["items"][] = [];
  const warnings: string[] = [];
  let dueDate: string | null = null;
  let statedInvoiceTotal: number | null = null;

  for (const file of files) {
    try {
      const extracted = await extractInterInvoiceImageLines(file);
      const parsed = parseInterInvoice(extracted.lines);
      const pageTotal = Number(
        parsed.items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
      );
      if (
        parsed.invoiceTotal !== null &&
        Math.abs(parsed.invoiceTotal - pageTotal) >= 0.01
      ) {
        statedInvoiceTotal = parsed.invoiceTotal;
      }
      parsedPages.push(parsed.items);
      dueDate ??= parsed.dueDate;
      warnings.push(...extracted.warnings);
      warnings.push(
        ...parsed.warnings.filter(
          (warning) => !/^A soma dos lan[cç]amentos foi/i.test(warning),
        ),
      );
    } catch {
      const generic = await parseCardInvoiceImages([file], bank);
      parsedPages.push(generic.items);
      dueDate ??= generic.dueDate;
      warnings.push(
        `${file.name} precisou usar a leitura genérica. Revise os lançamentos dessa imagem.`,
        ...generic.warnings,
      );
    }
  }

  const deduplicated = deduplicateOverlappingImageItems(parsedPages);
  const items = deduplicated.items.map((item, index) => ({
    ...item,
    id: index + 1,
  }));
  if (!items.length) {
    throw new Error(
      "O OCR abriu as imagens, mas não encontrou linhas completas com data, descrição e valor.",
    );
  }
  if (deduplicated.removed > 0) {
    warnings.push(
      `${deduplicated.removed} lançamento(s) repetido(s) em áreas sobrepostas dos prints foram removidos.`,
    );
  }

  const identifiedTotal = Number(
    items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  );
  if (
    statedInvoiceTotal !== null &&
    Math.abs(statedInvoiceTotal - identifiedTotal) >= 0.01
  ) {
    warnings.push(
      `Os prints informam uma fatura de R$ ${formatMoney(statedInvoiceTotal)}, mas contêm R$ ${formatMoney(identifiedTotal)} em lançamentos. A importação continuará somente com os itens presentes nas imagens.`,
    );
  }

  return {
    bank: "INTER",
    invoiceTotal: identifiedTotal,
    dueDate,
    items,
    warnings: [...new Set(warnings)],
  };
}

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

  if (normalized.includes("NUBANK")) {
    return parseNubankInvoice(lines);
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
  const normalized = bank
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (normalized.includes("INTER")) {
    return parseMultipleInterInvoiceImages(files, bank);
  }
  return parseCardInvoiceImages(files, bank);
}
