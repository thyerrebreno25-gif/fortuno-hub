import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const DATE_AT_START = /^\s*(\d{2})-(\d{2})-(\d{4})\b/;
const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const MONEY = /-?\s*\d{1,3}(?:\.\d{3})*,\d{2}\b|-?\s*\d+,\d{2}\b/g;
const CARD_FINAL = /\b\d{4}\s+XXXX\s+XXXX\s+(\d{4})\b/i;
const INSTALLMENT = /\bPARC\s+(\d{1,2})\s*\/\s*(\d{1,2})\b/i;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string): number | null {
  const negative = /^\s*-/.test(value) || /\(.*\)/.test(value);
  const parsed = Number(
    value
      .replace(/[()\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );

  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function toIsoDate(value: string) {
  const match = value.match(FULL_DATE);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function transactionDate(value: string) {
  const match = value.match(DATE_AT_START);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function extractHeaderDate(
  source: PdfTextLine[],
  label: RegExp,
  options: { minX: number; maxX?: number; stopLabel?: RegExp },
) {
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    const text = normalize(line.text);
    const labelMatch = text.match(label);
    if (!labelMatch) continue;

    let inline = text.slice((labelMatch.index ?? 0) + labelMatch[0].length);
    if (options.stopLabel) inline = inline.split(options.stopLabel)[0];
    const inlineDate = toIsoDate(inline);
    if (inlineDate) return inlineDate;

    for (let nearby = index; nearby <= Math.min(index + 2, source.length - 1); nearby += 1) {
      if (source[nearby].page !== line.page) continue;
      const datePart = (source[nearby].parts ?? []).find(
        (part) => part.x >= options.minX
          && (options.maxX === undefined || part.x < options.maxX)
          && FULL_DATE.test(part.text),
      );
      if (datePart) return toIsoDate(datePart.text);
    }
  }
  return null;
}

function extractInvoiceTotal(source: PdfTextLine[]) {
  for (const line of source) {
    const text = normalize(line.text);
    if (!/^Total de compras desta Fatura\b/i.test(text)) continue;
    const values = [...text.matchAll(MONEY)];
    const amount = values.at(-1) ? parseMoney(values.at(-1)![0]) : null;
    if (amount !== null) return Math.abs(amount);
  }

  return null;
}

function valueFromRealColumn(line: PdfTextLine) {
  const realColumn = (line.parts ?? [])
    .filter((part) => part.x >= 450 && part.x < 535)
    .map((part) => parseMoney(part.text))
    .filter((value): value is number => value !== null);

  if (realColumn.length) return realColumn.at(-1) ?? null;

  const values = [...normalize(line.text).matchAll(MONEY)];
  return values.at(-1) ? parseMoney(values.at(-1)![0]) : null;
}

function descriptionFromColumns(line: PdfTextLine, dateText: string, amount: number) {
  const descriptionParts = (line.parts ?? [])
    .filter((part) => part.x >= 55 && part.x < 178)
    .map((part) => part.text);

  if (descriptionParts.length) {
    return normalize(descriptionParts.join(" "));
  }

  const raw = normalize(line.text)
    .slice(dateText.length)
    .replace(new RegExp(`-?\\s*${Math.abs(amount).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "")
    .trim();

  return normalize(raw.split(/\bPARC\b/i)[0]);
}

function isInvoicePayment(description: string) {
  return /\b(?:DEB\s+AUTOM\s+DE\s+FATURA|PAGAMENTO\s+(?:DE|DA)\s+FATURA|PAGAMENTO\s+EFETUADO)\b/i.test(
    normalize(description),
  );
}

function parseTransaction(
  line: PdfTextLine,
  cardLastDigits: string | undefined,
): Omit<ParsedInvoiceItem, "id"> | null {
  const date = transactionDate(line.text);
  const dateText = line.text.match(DATE_AT_START)?.[0]?.trim();
  if (!date || !dateText) return null;

  const amount = valueFromRealColumn(line);
  if (amount === null || Math.abs(amount) < 0.005) return null;

  const description = descriptionFromColumns(line, dateText, amount);
  if (!description || isInvoicePayment(description)) return null;

  const installmentMatch = normalize(line.text).match(INSTALLMENT);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  const normalizedDescription = normalize(description).toUpperCase();
  const isInternationalIof = /\bIOF\b.*\bEXTERIOR\b/.test(normalizedDescription);
  const isInternational = !isInternationalIof
    && (line.parts ?? []).some((part) => /^(?:USD|EUR|GBP|CAD|AUD)$/i.test(part.text));

  return {
    date,
    description,
    amount,
    installment,
    cardLastDigits,
    transactionType: isInternationalIof
      ? "INTERNATIONAL_IOF"
      : isInternational
        ? "INTERNATIONAL_PURCHASE"
        : installment
          ? "INSTALLMENT_PURCHASE"
          : "PURCHASE",
    exportable: true,
  };
}

export function parseSantanderInvoice(source: PdfTextLine[]): ParsedInvoice {
  const warnings: string[] = [];
  const dueDate = extractHeaderDate(
    source,
    /Data de Vencimento\s*:/i,
    { minX: 300, maxX: 420, stopLabel: /Data (?:do|de) Fechamento da Fatura\s*:/i },
  );
  const closingDate = extractHeaderDate(
    source,
    /Data (?:do|de) Fechamento da Fatura\s*:/i,
    { minX: 500 },
  );
  const invoiceTotal = extractInvoiceTotal(source);
  const items: ParsedInvoiceItem[] = [];
  let inTransactions = false;
  let foundTransactions = false;
  let currentCard: string | undefined;

  for (const line of source) {
    const text = normalize(line.text);

    if (/^Demonstrativo de Transacoes$/i.test(text)) {
      inTransactions = true;
      foundTransactions = true;
      continue;
    }

    if (!inTransactions) continue;
    if (/^Total desta fatura$/i.test(text) || /^Total de compras desta Fatura\b/i.test(text)) {
      inTransactions = false;
      continue;
    }

    const card = text.match(CARD_FINAL);
    if (card) {
      currentCard = card[1];
      continue;
    }

    const transaction = parseTransaction(line, currentCard);
    if (transaction) items.push({ id: items.length + 1, ...transaction });
  }

  const identifiedTotal = Number(
    items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  );

  if (!foundTransactions) {
    warnings.push('A seção "Demonstrativo de Transações" não foi localizada na fatura Santander.');
  }
  if (!dueDate) {
    warnings.push("A data de vencimento não foi identificada automaticamente na fatura Santander.");
  }
  if (!closingDate) {
    warnings.push("A data de fechamento não foi identificada automaticamente na fatura Santander.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout Santander.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura Santander.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "SANTANDER",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
