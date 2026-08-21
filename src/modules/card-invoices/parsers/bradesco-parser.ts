import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const DATE_AT_START = /^\s*(\d{1,2})\/(\d{1,2})\b/;
const FULL_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const MONEY = /[+-]?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}\b/g;
const INSTALLMENT = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/g;

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

function extractDueDate(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    if (!/data\s+de\s+vencimento/i.test(normalize(lines[index]))) continue;

    for (let nearby = index; nearby <= Math.min(index + 2, lines.length - 1); nearby += 1) {
      const match = lines[nearby].match(FULL_DATE);
      if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  return null;
}

function extractStatementYear(lines: string[], dueDate: string | null): number {
  if (dueDate) return Number(dueDate.slice(0, 4));

  for (const line of lines) {
    const match = normalize(line).match(/\b(?:mes|mês)\s*:\s*[a-z]+\s*\/\s*(20\d{2})\b/i);
    if (match) return Number(match[1]);
  }

  const year = lines.join(" ").match(/\b20\d{2}\b/);
  return year ? Number(year[0]) : new Date().getFullYear();
}

function resolveTransactionYear(month: number, dueDate: string | null, statementYear: number): number {
  if (!dueDate) return statementYear;

  const dueYear = Number(dueDate.slice(0, 4));
  const dueMonth = Number(dueDate.slice(5, 7));

  // Uma fatura fechada pode carregar parcelas compradas no ano anterior.
  // Se o mês da compra está depois do mês de vencimento, ele pertence ao ano anterior.
  return month > dueMonth ? dueYear - 1 : dueYear;
}

function extractInvoiceTotal(source: PdfTextLine[]): number | null {
  for (const line of source) {
    if (!/^\s*total\s*:/i.test(normalize(line.text))) continue;

    const matches = [...line.text.matchAll(MONEY)];
    const last = matches.at(-1);
    if (!last) continue;

    const amount = parseMoney(last[0]);
    if (amount !== null) return Math.abs(amount);
  }

  return null;
}

function extractCardLastDigits(lines: string[]): string | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    if (!/numero\s+do\s+cartao/i.test(normalize(lines[index]))) continue;

    for (let nearby = index; nearby <= Math.min(index + 1, lines.length - 1); nearby += 1) {
      const match = lines[nearby].match(/(?:X{2,}[.\s-]*)+(\d{4})\b/i);
      if (match) return match[1];
    }
  }

  return undefined;
}

function extractInstallment(description: string): { value?: string; description: string } {
  const matches = [...description.matchAll(INSTALLMENT)];
  const candidate = matches.at(-1);
  if (!candidate || candidate.index === undefined) return { description };

  const current = Number(candidate[1]);
  const total = Number(candidate[2]);
  if (current < 1 || total < 2 || current > total) return { description };

  const cleaned = `${description.slice(0, candidate.index)} ${description.slice(candidate.index + candidate[0].length)}`
    .replace(/\s+/g, " ")
    .trim();

  return { value: `${current}/${total}`, description: cleaned };
}

function isInvoicePayment(description: string): boolean {
  const key = normalize(description).toUpperCase();
  return key.includes("PAGAMENTO DA FATURA")
    || key.includes("PAGAMENTO DE FATURA")
    || key.includes("PAGAMENTO EM CONTA")
    || /^PAGAMENTO\b/.test(key);
}

function parseMovement(
  line: PdfTextLine,
  dueDate: string | null,
  statementYear: number,
  cardLastDigits: string | undefined,
  id: number,
): ParsedInvoiceItem | null {
  const dateMatch = line.text.match(DATE_AT_START);
  if (!dateMatch) return null;

  const moneyMatches = [...line.text.matchAll(MONEY)];
  const lastMoney = moneyMatches.at(-1);
  const firstMoney = moneyMatches[0];
  if (!lastMoney || !firstMoney || firstMoney.index === undefined) return null;

  const parsedAmount = parseMoney(lastMoney[0]);
  if (parsedAmount === null || parsedAmount <= 0) return null;

  const rawDescription = line.text
    .slice(dateMatch[0].length, firstMoney.index)
    .replace(/\s+/g, " ")
    .trim();
  if (!rawDescription || isInvoicePayment(rawDescription)) return null;

  const installment = extractInstallment(rawDescription);
  if (!installment.description) return null;

  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const firstColumnAmount = parseMoney(firstMoney[0]) ?? 0;
  const iof = /^IOF\b/i.test(normalize(installment.description));
  const international = !iof && Math.abs(firstColumnAmount) > 0;

  return {
    id,
    date: toIsoDate(day, month, resolveTransactionYear(month, dueDate, statementYear)),
    description: installment.description,
    amount: Math.abs(parsedAmount),
    installment: installment.value,
    cardLastDigits,
    transactionType: iof
      ? "INTERNATIONAL_IOF"
      : international
        ? "INTERNATIONAL_PURCHASE"
        : installment.value
          ? "INSTALLMENT_PURCHASE"
          : "PURCHASE",
    exportable: true,
  };
}

function removeDuplicates(items: ParsedInvoiceItem[]): ParsedInvoiceItem[] {
  const seen = new Set<string>();
  const result: ParsedInvoiceItem[] = [];

  for (const item of items) {
    const key = [
      item.date,
      normalize(item.description).toUpperCase(),
      item.installment ?? "",
      item.amount.toFixed(2),
      item.cardLastDigits ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...item, id: result.length + 1 });
  }

  return result;
}

export function parseBradescoInvoice(source: PdfTextLine[]): ParsedInvoice {
  const lines = source.map((line) => line.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const warnings: string[] = [];
  const dueDate = extractDueDate(lines);
  const statementYear = extractStatementYear(lines, dueDate);
  const cardLastDigits = extractCardLastDigits(lines);
  const invoiceTotal = extractInvoiceTotal(source);

  const items = removeDuplicates(
    source
      .map((line, index) => parseMovement(line, dueDate, statementYear, cardLastDigits, index + 1))
      .filter((item): item is ParsedInvoiceItem => item !== null),
  );
  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout do Bradesco.");
  }
  if (!dueDate) {
    warnings.push("O vencimento não foi identificado automaticamente na fatura do Bradesco.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura do Bradesco.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "BRADESCO",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
