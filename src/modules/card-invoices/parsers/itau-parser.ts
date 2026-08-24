import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const DATE_AT_START = /^\s*(\d{1,2})\/(\d{1,2})\b/;
const FULL_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const MONEY = /-?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}\b/gi;
const INSTALLMENT = /(\d{1,2})\s*\/\s*(\d{1,2})\b/;

const MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

type RawMovement = {
  date: string;
  description: string;
  amount: number;
  installment?: string;
  cardLastDigits?: string;
};

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
      .replace(/[()\s]/g, "")
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

function extractDueDate(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bvencimento\s*:/i.test(normalize(lines[index]))) continue;

    for (let nearby = index; nearby <= Math.min(index + 2, lines.length - 1); nearby += 1) {
      const date = parseFullDate(lines[nearby]);
      if (date) return date;
    }
  }

  return null;
}

function extractClosingDate(lines: string[], dueDate: string | null): string | null {
  const dueYear = dueDate ? Number(dueDate.slice(0, 4)) : new Date().getFullYear();

  for (let index = 0; index < lines.length; index += 1) {
    if (!/data\s+de\s+fechamento\s*:/i.test(normalize(lines[index]))) continue;

    for (let nearby = index; nearby <= Math.min(index + 2, lines.length - 1); nearby += 1) {
      const fullDate = parseFullDate(lines[nearby]);
      if (fullDate && fullDate !== dueDate) return fullDate;

      const textDate = normalize(lines[nearby]).toLowerCase().match(/\b(\d{1,2})\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
      if (textDate) {
        return toIsoDate(Number(textDate[1]), MONTHS[textDate[2]], dueYear);
      }
    }
  }

  return dueDate;
}

function extractInvoiceTotal(source: PdfTextLine[]): number | null {
  for (const line of source) {
    if (!/^\s*total\s+da\s+fatura\b/i.test(normalize(line.text))) continue;
    const values = [...line.text.matchAll(MONEY)];
    const last = values.at(-1);
    if (!last) continue;
    const amount = parseMoney(last[0]);
    if (amount !== null) return Math.abs(amount);
  }

  return null;
}

function resolveYear(day: number, month: number, closingDate: string): number {
  const closingYear = Number(closingDate.slice(0, 4));
  const closingMonth = Number(closingDate.slice(5, 7));
  const closingDay = Number(closingDate.slice(8, 10));

  return month > closingMonth || (month === closingMonth && day > closingDay)
    ? closingYear - 1
    : closingYear;
}

function extractInstallment(description: string): { description: string; value?: string } {
  const matches = [...description.matchAll(new RegExp(INSTALLMENT.source, "g"))];
  const match = matches.at(-1);
  if (!match || match.index === undefined) return { description };

  const current = Number(match[1]);
  const total = Number(match[2]);
  if (current < 1 || total < 2 || current > total) return { description };

  const cleaned = `${description.slice(0, match.index)} ${description.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .trim();

  return { description: cleaned, value: `${current}/${total}` };
}

function parseMovement(
  line: PdfTextLine,
  closingDate: string,
  cardLastDigits: string | undefined,
): RawMovement | null {
  const dateMatch = line.text.match(DATE_AT_START);
  if (!dateMatch) return null;

  const values = [...line.text.matchAll(MONEY)];
  const last = values.at(-1);
  if (!last || last.index === undefined) return null;

  const amount = parseMoney(last[0]);
  if (amount === null || amount === 0) return null;

  const rawDescription = line.text
    .slice(dateMatch[0].length, last.index)
    .replace(/\s+/g, " ")
    .trim();
  if (!rawDescription) return null;

  const installment = extractInstallment(rawDescription);
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);

  return {
    date: toIsoDate(day, month, resolveYear(day, month, closingDate)),
    description: installment.description,
    amount,
    installment: installment.value,
    cardLastDigits,
  };
}

function merchantKey(description: string): string {
  return normalize(description)
    .toUpperCase()
    .replace(/^(?:ESTORNO|CREDITO)(?:\s+DE)?\s+/, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameMerchant(left: string, right: string): boolean {
  const a = merchantKey(left);
  const b = merchantKey(right);
  const shortest = Math.min(a.length, b.length);

  return shortest >= 6 && (a.startsWith(b) || b.startsWith(a));
}

function isExplicitReversal(description: string): boolean {
  return /^(?:ESTORNO|CREDITO)\b/i.test(normalize(description));
}

function reconcileCredits(movements: RawMovement[]): RawMovement[] {
  const positives = movements
    .filter((movement) => movement.amount > 0)
    .map((movement) => ({ ...movement }));
  const credits = movements.filter((movement) => movement.amount < 0);
  const remainingCredits: RawMovement[] = [];

  for (const credit of credits) {
    let candidates = positives.filter(
      (movement) => movement.amount > 0
        && movement.date === credit.date
        && sameMerchant(movement.description, credit.description),
    );

    // Estornos identificados pelo banco podem aparecer dias depois da cobrança.
    if (!candidates.length && isExplicitReversal(credit.description)) {
      candidates = positives.filter(
        (movement) => movement.amount > 0
          && sameMerchant(movement.description, credit.description),
      );
    }

    let remaining = Math.abs(credit.amount);

    if (!candidates.length) {
      remainingCredits.push({ ...credit });
      continue;
    }

    for (const candidate of candidates) {
      if (remaining <= 0.004) break;
      const applied = Math.min(candidate.amount, remaining);
      candidate.amount = Number((candidate.amount - applied).toFixed(2));
      remaining = Number((remaining - applied).toFixed(2));
    }

    if (remaining > 0.004) {
      remainingCredits.push({ ...credit, amount: -remaining });
    }
  }

  return [
    ...positives.filter((movement) => movement.amount >= 0.01),
    ...remainingCredits,
  ].sort((left, right) => left.date.localeCompare(right.date));
}

export function parseItauInvoice(source: PdfTextLine[]): ParsedInvoice {
  const lines = source.map((line) => line.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const warnings: string[] = [];
  const dueDate = extractDueDate(lines);
  const closingDate = extractClosingDate(lines, dueDate);
  const invoiceTotal = extractInvoiceTotal(source);
  const movements: RawMovement[] = [];
  let inMovements = false;
  let foundMovements = false;
  let currentCard: string | undefined;

  if (closingDate) {
    for (const line of source) {
      const key = normalize(line.text);
      if (/^Lancamentos$/i.test(key)) {
        inMovements = true;
        foundMovements = true;
        continue;
      }
      if (inMovements && /^Total de lancamentos nacionais\b/i.test(key)) break;
      if (!inMovements) continue;

      const card = key.match(/\bFINAL\s+(\d{4})\b/i);
      if (card) {
        currentCard = card[1];
        continue;
      }

      const movement = parseMovement(line, closingDate, currentCard);
      if (movement) movements.push(movement);
    }
  }

  const reconciled = reconcileCredits(movements);
  const items: ParsedInvoiceItem[] = reconciled.map((movement, index) => ({
    id: index + 1,
    date: movement.date,
    description: movement.description,
    amount: movement.amount,
    installment: movement.installment,
    cardLastDigits: movement.cardLastDigits,
    transactionType: movement.installment ? "INSTALLMENT_PURCHASE" : "PURCHASE",
    exportable: true,
  }));
  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!foundMovements) {
    warnings.push('A seção "Lançamentos" não foi localizada no PDF do Itaú.');
  }
  if (!closingDate) {
    warnings.push("A data de fechamento não foi identificada automaticamente na fatura do Itaú.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout do Itaú.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura do Itaú.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "ITAU",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
