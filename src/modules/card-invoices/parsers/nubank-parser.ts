import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const MONEY_AT_END = /([−-]?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2})\s*$/i;
const MONEY = /[−-]?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/gi;
const TEXT_DATE = /\b(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})\b/i;
const TRANSACTION_DATE = /^\s*(\d{1,2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b/i;
const INSTALLMENT = /\s*-?\s*Parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;
const CARD_PREFIX = /^(?:[•·*]\s*){2,}(\d{4})\s*/u;

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEV: 2,
  MAR: 3,
  ABR: 4,
  MAI: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SET: 9,
  OUT: 10,
  NOV: 11,
  DEZ: 12,
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string): number | null {
  const negative = /[−-]/.test(value);
  const parsed = Number(
    value
      .replace(/[−-]/g, "")
      .replace(/R\$/gi, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.]/g, ""),
  );
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function isoDate(day: number, month: number, year: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseTextDate(value: string): string | null {
  const match = normalize(value).match(TEXT_DATE);
  return match ? isoDate(Number(match[1]), MONTHS[match[2].toUpperCase()], Number(match[3])) : null;
}

function extractDueDate(source: PdfTextLine[]) {
  for (let index = 0; index < source.length; index += 1) {
    const text = normalize(source[index].text);
    if (!/^Data de vencimento\s*:/i.test(text)) continue;
    const inline = parseTextDate(text);
    if (inline) return inline;
    for (let nearby = index + 1; nearby <= Math.min(index + 2, source.length - 1); nearby += 1) {
      const date = parseTextDate(source[nearby].text);
      if (date) return date;
    }
  }
  return null;
}

function extractClosingDate(source: PdfTextLine[], dueDate: string | null) {
  for (const line of source) {
    const text = normalize(line.text);
    const label = text.match(/EMISSAO E ENVIO\s+/i);
    if (!label || label.index === undefined) continue;
    const date = parseTextDate(text.slice(label.index + label[0].length));
    if (date) return date;
  }
  return dueDate;
}

function extractInvoiceTotal(source: PdfTextLine[]) {
  for (const line of source) {
    const text = normalize(line.text);
    if (!/^Total a pagar\b/i.test(text)) continue;
    const values = [...text.matchAll(MONEY)];
    if (values.length !== 1) continue;
    const amount = parseMoney(values[0][0]);
    if (amount !== null) return Math.abs(amount);
  }

  for (let index = 0; index < source.length; index += 1) {
    if (!/esta e a sua fatura/i.test(normalize(source[index].text))) continue;
    for (let nearby = index + 1; nearby <= Math.min(index + 4, source.length - 1); nearby += 1) {
      const match = normalize(source[nearby].text).match(MONEY_AT_END);
      const amount = match ? parseMoney(match[1]) : null;
      if (amount !== null) return Math.abs(amount);
    }
  }
  return null;
}

function resolveTransactionDate(value: string, closingDate: string) {
  const match = normalize(value).match(TRANSACTION_DATE);
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2].toUpperCase()];
  const closingYear = Number(closingDate.slice(0, 4));
  const closingMonth = Number(closingDate.slice(5, 7));
  const closingDay = Number(closingDate.slice(8, 10));
  const year = month > closingMonth || (month === closingMonth && day > closingDay)
    ? closingYear - 1
    : closingYear;
  return isoDate(day, month, year);
}

function parseTransaction(
  textValue: string,
  date: string,
): Omit<ParsedInvoiceItem, "id"> | null {
  const text = String(textValue ?? "").replace(/\s+/g, " ").trim();
  const amountMatch = text.match(MONEY_AT_END);
  if (!amountMatch || amountMatch.index === undefined) return null;
  const amount = parseMoney(amountMatch[1]);
  if (amount === null || Math.abs(amount) < 0.005) return null;

  let description = text.slice(0, amountMatch.index).trim();
  const card = description.match(CARD_PREFIX);
  const cardLastDigits = card?.[1];
  if (card) description = description.slice(card[0].length).trim();
  if (!description || /^(?:Pagamento em|Saldo restante da fatura anterior)\b/i.test(normalize(description))) {
    return null;
  }

  const installmentMatch = description.match(INSTALLMENT);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  if (installmentMatch?.index !== undefined) {
    description = description.slice(0, installmentMatch.index).trim();
  }

  return {
    date,
    description,
    amount,
    installment,
    cardLastDigits,
    transactionType: installment ? "INSTALLMENT_PURCHASE" : "PURCHASE",
    exportable: true,
  };
}

export function parseNubankInvoice(source: PdfTextLine[]): ParsedInvoice {
  const warnings: string[] = [];
  const dueDate = extractDueDate(source);
  const closingDate = extractClosingDate(source, dueDate);
  const invoiceTotal = extractInvoiceTotal(source);
  const items: ParsedInvoiceItem[] = [];
  let inTransactions = false;
  let foundTransactions = false;
  let pendingDate: string | null = null;

  for (const line of source) {
    const text = normalize(line.text);
    if (/^TRANSACOES$/i.test(text)) {
      inTransactions = true;
      foundTransactions = true;
      pendingDate = null;
      continue;
    }
    if (!inTransactions) continue;
    if (/^Pagamentos e Financiamentos\b/i.test(text)) {
      inTransactions = false;
      pendingDate = null;
      continue;
    }
    if (!closingDate) continue;

    const dateMatch = text.match(TRANSACTION_DATE);
    if (dateMatch) {
      const date = resolveTransactionDate(dateMatch[0], closingDate);
      if (!date) continue;
      const inlineRemainder = text.slice(dateMatch[0].length).trim();
      if (inlineRemainder) {
        const transaction = parseTransaction(inlineRemainder, date);
        if (transaction) items.push({ id: items.length + 1, ...transaction });
        pendingDate = null;
      } else {
        pendingDate = date;
      }
      continue;
    }

    if (!pendingDate) continue;
    const transaction = parseTransaction(line.text, pendingDate);
    if (transaction) {
      items.push({ id: items.length + 1, ...transaction });
      pendingDate = null;
    }
  }

  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));
  if (!foundTransactions) warnings.push('A seção "Transações" não foi localizada na fatura Nubank.');
  if (!dueDate) warnings.push("A data de vencimento não foi identificada automaticamente na fatura Nubank.");
  if (!closingDate) warnings.push("A data de fechamento não foi identificada automaticamente na fatura Nubank.");
  if (!items.length) warnings.push("Nenhum lançamento exportável foi identificado no layout Nubank.");
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura Nubank.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return { bank: "NUBANK", invoiceTotal, dueDate, items, warnings };
}
