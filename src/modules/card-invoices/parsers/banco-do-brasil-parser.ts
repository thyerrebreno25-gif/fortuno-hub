import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const DATE_AT_START = /^\s*(\d{1,2})\/(\d{1,2})\b/;
const FULL_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const MONEY = /[+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b/g;
const INSTALLMENT = /\b((?:ADC-)?PARC)\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i;

function normalize(value: string): string {
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
      .replace(/R\$/gi, "")
      .replace(/[()+\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );

  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function toIsoDate(day: number, month: number, year: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseFullDate(value: string): string | null {
  const match = value.match(FULL_DATE);
  return match ? toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function findLabeledDate(lines: string[], label: RegExp): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!label.test(normalize(lines[index]))) continue;

    for (let nearby = index; nearby <= Math.min(index + 2, lines.length - 1); nearby += 1) {
      const date = parseFullDate(lines[nearby]);
      if (date) return date;
    }
  }

  return null;
}

function extractInvoiceTotal(source: PdfTextLine[]): number | null {
  const preferred = [
    /total\s+da\s+fatura\s*:/i,
    /valor\s+da\s+fatura\s*:/i,
  ];

  for (const pattern of preferred) {
    for (const line of source) {
      if (!pattern.test(normalize(line.text))) continue;
      const matches = [...line.text.matchAll(MONEY)];
      const value = matches.at(-1);
      if (!value) continue;
      const amount = parseMoney(value[0]);
      if (amount !== null) return Math.abs(amount);
    }
  }

  return null;
}

function extractInstallment(description: string): {
  description: string;
  current?: number;
  total?: number;
  value?: string;
} {
  const match = description.match(INSTALLMENT);
  if (!match || match.index === undefined) return { description };

  const current = Number(match[2]);
  const total = Number(match[3]);
  if (current < 1 || total < 2 || current > total) return { description };

  const cleaned = `${description.slice(0, match.index)} ${description.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .trim();

  return {
    description: cleaned,
    current,
    total,
    value: `${current}/${total}`,
  };
}

function resolveRegularYear(day: number, month: number, closingDate: string): number {
  const closingYear = Number(closingDate.slice(0, 4));
  const closingMonth = Number(closingDate.slice(5, 7));
  const closingDay = Number(closingDate.slice(8, 10));

  return month > closingMonth || (month === closingMonth && day > closingDay)
    ? closingYear - 1
    : closingYear;
}

function resolveInstallmentYear(
  day: number,
  month: number,
  currentInstallment: number,
  closingDate: string,
): number {
  const closingYear = Number(closingDate.slice(0, 4));
  const closingMonth = Number(closingDate.slice(5, 7));

  // A primeira parcela pode entrar no mesmo ciclo da compra ou no ciclo seguinte.
  // Procuramos o ano cuja distância até o fechamento corresponda a uma dessas opções.
  for (let year = closingYear; year >= closingYear - 9; year -= 1) {
    const monthDistance = (closingYear - year) * 12 + closingMonth - month;
    if (monthDistance === currentInstallment - 1 || monthDistance === currentInstallment) {
      return year;
    }
  }

  return resolveRegularYear(day, month, closingDate);
}

function isPaymentOrCredit(description: string): boolean {
  const key = normalize(description).toUpperCase();
  return key.includes("PGTO DEBITO CONTA")
    || key.includes("PAGAMENTO DA FATURA")
    || key.includes("PAGAMENTO DE FATURA")
    || /^PAGAMENTO\b/.test(key);
}

function cleanDescription(value: string): { description: string; country?: string } {
  const normalized = value.replace(/\s+/g, " ").trim();
  const countryMatch = normalized.match(/\s+([A-Z]{2})$/);

  if (!countryMatch || countryMatch.index === undefined) {
    return { description: normalized };
  }

  return {
    description: normalized.slice(0, countryMatch.index).trim(),
    country: countryMatch[1],
  };
}

function parseMovement(
  line: PdfTextLine,
  closingDate: string,
  cardLastDigits: string | undefined,
  id: number,
): ParsedInvoiceItem | null {
  const dateMatch = line.text.match(DATE_AT_START);
  if (!dateMatch) return null;

  const moneyMatches = [...line.text.matchAll(MONEY)];
  const lastMoney = moneyMatches.at(-1);
  if (!lastMoney || lastMoney.index === undefined) return null;

  const amount = parseMoney(lastMoney[0]);
  if (amount === null || amount <= 0) return null;

  const rawDescription = line.text
    .slice(dateMatch[0].length, lastMoney.index)
    .replace(/\s+/g, " ")
    .trim();
  const cleaned = cleanDescription(rawDescription);
  if (!cleaned.description || isPaymentOrCredit(cleaned.description)) return null;

  const installment = extractInstallment(cleaned.description);
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = installment.current
    ? resolveInstallmentYear(day, month, installment.current, closingDate)
    : resolveRegularYear(day, month, closingDate);
  const iof = /^IOF\b/i.test(normalize(installment.description));
  const international = !iof && Boolean(cleaned.country && cleaned.country !== "BR");

  return {
    id,
    date: toIsoDate(day, month, year),
    description: installment.description,
    amount,
    installment: installment.value,
    cardLastDigits,
    transactionType: iof && /EXTERIOR/i.test(normalize(installment.description))
      ? "INTERNATIONAL_IOF"
      : international
        ? "INTERNATIONAL_PURCHASE"
        : installment.value
          ? "INSTALLMENT_PURCHASE"
          : "PURCHASE",
    exportable: true,
  };
}

export function parseBancoDoBrasilInvoice(source: PdfTextLine[]): ParsedInvoice {
  const lines = source.map((line) => line.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const warnings: string[] = [];
  const dueDate = findLabeledDate(lines, /\bvencimento\s*:/i);
  const closingDate = findLabeledDate(lines, /fatura\s+fechada\s+em\s*:/i)
    ?? findLabeledDate(lines, /^fechada\s+em\s*:/i)
    ?? dueDate;
  const invoiceTotal = extractInvoiceTotal(source);
  const items: ParsedInvoiceItem[] = [];
  let inDetails = false;
  let foundDetails = false;
  let currentCard: string | undefined;

  if (closingDate) {
    for (const line of source) {
      const key = normalize(line.text);
      if (/^Detalhes da fatura$/i.test(key)) {
        inDetails = true;
        foundDetails = true;
        continue;
      }
      if (inDetails && /^Total da fatura\s*:/i.test(key)) break;
      if (!inDetails) continue;

      const card = key.match(/Cartao\s+(\d{4})\b/i);
      if (card) {
        currentCard = card[1];
        continue;
      }

      const movement = parseMovement(line, closingDate, currentCard, items.length + 1);
      if (movement) items.push(movement);
    }
  }

  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!foundDetails) {
    warnings.push('A seção "Detalhes da fatura" não foi localizada no PDF do Banco do Brasil.');
  }
  if (!closingDate) {
    warnings.push("A data de fechamento não foi identificada automaticamente.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout do Banco do Brasil.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura do Banco do Brasil.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "BANCO_DO_BRASIL",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
