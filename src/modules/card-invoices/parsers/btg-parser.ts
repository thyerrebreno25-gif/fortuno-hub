import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const SHORT_DATE = /^(\d{2})\/(\d{2})$/;
const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const MONEY = /^-?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}$/i;
const INSTALLMENT = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string) {
  const negative = /^\s*-/.test(value);
  const parsed = Number(
    value
      .replace(/R\$/gi, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function toIsoDate(day: number, month: number, year: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractDueDate(source: PdfTextLine[]) {
  for (const line of source) {
    if (!/\bVencimento\s*:/i.test(normalize(line.text))) continue;
    const match = normalize(line.text).match(FULL_DATE);
    if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return null;
}

function extractInvoiceTotal(source: PdfTextLine[]) {
  for (const line of source) {
    if (!/^Total de compras e despesas dessa fatura\b/i.test(normalize(line.text))) continue;
    const amountPart = [...(line.parts ?? [])].reverse().find((part) => MONEY.test(part.text.trim()));
    const match = amountPart?.text ?? normalize(line.text).match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/)?.[0];
    if (!match) continue;
    const amount = parseMoney(match);
    if (amount !== null) return Math.abs(amount);
  }
  return null;
}

function resolveYear(day: number, month: number, dueDate: string) {
  const dueYear = Number(dueDate.slice(0, 4));
  const dueMonth = Number(dueDate.slice(5, 7));
  const dueDay = Number(dueDate.slice(8, 10));
  return month > dueMonth || (month === dueMonth && day > dueDay)
    ? dueYear - 1
    : dueYear;
}

function parseTransactionBlock(
  parts: Array<{ x: number; text: string }>,
  dueDate: string,
  cardLastDigits: string | undefined,
): Omit<ParsedInvoiceItem, "id"> | null {
  const datePart = parts.find((part) => SHORT_DATE.test(part.text.trim()));
  const amountPart = [...parts].reverse().find((part) => MONEY.test(part.text.trim()));
  if (!datePart || !amountPart) return null;

  const dateMatch = datePart.text.trim().match(SHORT_DATE);
  const amount = parseMoney(amountPart.text);
  if (!dateMatch || amount === null || Math.abs(amount) < 0.005) return null;

  const rawDescription = normalize(
    parts
      .filter((part) => part.x > datePart.x && part.x < amountPart.x)
      .map((part) => part.text)
      .join(" "),
  );
  if (!rawDescription || /Pagamento de fatura/i.test(rawDescription)) return null;

  const installmentMatch = rawDescription.match(INSTALLMENT);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  const description = normalize(rawDescription.replace(INSTALLMENT, ""));
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);

  return {
    date: toIsoDate(day, month, resolveYear(day, month, dueDate)),
    description,
    amount,
    installment,
    cardLastDigits,
    transactionType: installment ? "INSTALLMENT_PURCHASE" : "PURCHASE",
    exportable: true,
  };
}

export function parseBtgInvoice(source: PdfTextLine[]): ParsedInvoice {
  const warnings: string[] = [];
  const dueDate = extractDueDate(source);
  const invoiceTotal = extractInvoiceTotal(source);
  const items: ParsedInvoiceItem[] = [];
  let foundTransactions = false;
  let currentCard: string | undefined;

  for (const line of source) {
    const text = normalize(line.text);
    const card = text.match(/^Lancamentos do cartao .+?\bFinal\s+(\d{4})\b/i);
    if (card) {
      currentCard = card[1];
      foundTransactions = true;
      continue;
    }

    if (!foundTransactions || !dueDate) continue;

    // O BTG pode imprimir duas compras na mesma linha visual. Cada metade da
    // página é uma transação independente e precisa ser lida separadamente.
    const parts = line.parts ?? [];
    const blocks = [
      parts.filter((part) => part.x < 300),
      parts.filter((part) => part.x >= 300),
    ];

    for (const block of blocks) {
      const transaction = parseTransactionBlock(block, dueDate, currentCard);
      if (transaction) items.push({ id: items.length + 1, ...transaction });
    }
  }

  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!foundTransactions) {
    warnings.push('A seção "Lançamentos do cartão" não foi localizada na fatura BTG.');
  }
  if (!dueDate) {
    warnings.push("A data de vencimento não foi identificada automaticamente na fatura BTG.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout BTG.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura BTG.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "BTG",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
