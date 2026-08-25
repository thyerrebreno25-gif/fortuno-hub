import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const SHORT_DATE = /^(\d{2})\/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i;
const MONEY = /^-?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}$/i;
const INSTALLMENT = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;

const MONTHS: Record<string, number> = {
  jan: 1,
  fev: 2,
  mar: 3,
  abr: 4,
  mai: 5,
  jun: 6,
  jul: 7,
  ago: 8,
  set: 9,
  out: 10,
  nov: 11,
  dez: 12,
};

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
    const text = normalize(line.text);
    if (!/\bVencimento\b/i.test(text)) continue;
    const match = text.match(FULL_DATE);
    if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return null;
}

function extractInvoiceTotal(source: PdfTextLine[]) {
  for (const line of source) {
    const text = normalize(line.text);
    if (!/^Total fatura de\b/i.test(text)) continue;
    const amountPart = [...(line.parts ?? [])].reverse().find((part) => MONEY.test(part.text.trim()));
    const value = amountPart?.text ?? text.match(/R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}/)?.[0];
    if (!value) continue;
    const amount = parseMoney(value);
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

function parseTransaction(
  source: PdfTextLine[],
  line: PdfTextLine,
  dueDate: string,
  cardLastDigits: string | undefined,
): Omit<ParsedInvoiceItem, "id"> | null {
  const parts = line.parts ?? [];
  const datePart = parts.find((part) => SHORT_DATE.test(normalize(part.text)));
  const amountPart = [...parts].reverse().find((part) => MONEY.test(part.text.trim()));
  if (!datePart || !amountPart) return null;

  const dateMatch = normalize(datePart.text).match(SHORT_DATE);
  const amount = parseMoney(amountPart.text);
  if (!dateMatch || amount === null || Math.abs(amount) < 0.005) return null;

  // O primeiro lançamento pode ocupar três linhas visuais. Reunimos apenas
  // partes próximas da mesma linha e das colunas Descrição/Parcela.
  const nearby = source
    .filter((candidate) => candidate.page === line.page && Math.abs(candidate.y - line.y) <= 5)
    .flatMap((candidate) => (candidate.parts ?? []).map((part) => ({ ...part, y: candidate.y })))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const descriptionWithInstallment = normalize(
    nearby
      .filter((part) => part.x >= 230 && part.x < 380)
      .map((part) => part.text)
      .join(" "),
  );
  if (!descriptionWithInstallment || /^Pagamento\b/i.test(descriptionWithInstallment)) return null;

  const installmentMatch = descriptionWithInstallment.match(INSTALLMENT);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  const description = normalize(descriptionWithInstallment.replace(INSTALLMENT, ""));
  const day = Number(dateMatch[1]);
  const month = MONTHS[dateMatch[2].toLowerCase()];
  const normalizedDescription = normalize(description).toUpperCase();
  const isInternationalIof = /\bIOF\b.*\bCOMPRA INTERNACIONAL\b/.test(normalizedDescription);
  const isInternational = !isInternationalIof && parts.some(
    (part) => part.x >= 380 && part.x < 500 && /\b(?:US\$|USD|EUR|GBP)\b|=\s*US\$/i.test(part.text),
  );

  return {
    date: toIsoDate(day, month, resolveYear(day, month, dueDate)),
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

export function parseSicrediInvoice(source: PdfTextLine[]): ParsedInvoice {
  const warnings: string[] = [];
  const dueDate = extractDueDate(source);
  const invoiceTotal = extractInvoiceTotal(source);
  const items: ParsedInvoiceItem[] = [];
  let foundTransactions = false;
  let currentCard: string | undefined;

  for (const line of source) {
    const text = normalize(line.text);
    if (/^Transacoes$/i.test(text)) {
      foundTransactions = true;
      continue;
    }
    if (!foundTransactions) continue;

    const card = text.match(/^Cartao .+?\(final\s+(\d{4})\)$/i);
    if (card) {
      currentCard = card[1];
      continue;
    }

    if (!dueDate) continue;
    const transaction = parseTransaction(source, line, dueDate, currentCard);
    if (transaction) items.push({ id: items.length + 1, ...transaction });
  }

  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!foundTransactions) {
    warnings.push('A seção "Transações" não foi localizada na fatura Sicredi.');
  }
  if (!dueDate) {
    warnings.push("A data de vencimento não foi identificada automaticamente na fatura Sicredi.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout Sicredi.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura Sicredi.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "SICREDI",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
