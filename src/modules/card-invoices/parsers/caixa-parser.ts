import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const SHORT_DATE = /^(\d{2})\/(\d{2})$/;
const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const SIGNED_MONEY = /^(\d{1,3}(?:\.\d{3})*,\d{2})\s*([DC])$/i;
const INSTALLMENT = /\b(\d{1,2})\s+DE\s+(\d{1,2})\b/i;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(value: string) {
  const parsed = Number(
    value
      .replace(/R\$/gi, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, ""),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function toIsoDate(day: number, month: number, year: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractDueDate(source: PdfTextLine[]) {
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    if (!/^VENCIMENTO$/i.test(normalize(line.text))) continue;

    for (let nearby = index; nearby <= Math.min(index + 3, source.length - 1); nearby += 1) {
      if (source[nearby].page !== line.page) continue;
      const match = normalize(source[nearby].text).match(FULL_DATE);
      if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
  }

  return null;
}

function extractInvoiceTotal(source: PdfTextLine[]) {
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    if (!/^VALOR TOTAL DESTA FATURA$/i.test(normalize(line.text))) continue;

    for (let nearby = index; nearby <= Math.min(index + 6, source.length - 1); nearby += 1) {
      if (source[nearby].page !== line.page) continue;
      const values = normalize(source[nearby].text).match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g);
      if (!values?.length) continue;
      const amount = parseMoney(values.at(-1)!);
      if (amount !== null) return Math.abs(amount);
    }
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

function parseMovement(
  line: PdfTextLine,
  dueDate: string,
  cardLastDigits: string | undefined,
): Omit<ParsedInvoiceItem, "id"> | null {
  const parts = line.parts ?? [];
  const datePart = parts.find((part) => SHORT_DATE.test(part.text.trim()));
  const amountPart = [...parts].reverse().find((part) => SIGNED_MONEY.test(part.text.trim()));
  if (!datePart || !amountPart) return null;

  const dateMatch = datePart.text.trim().match(SHORT_DATE);
  const amountMatch = amountPart.text.trim().match(SIGNED_MONEY);
  if (!dateMatch || !amountMatch) return null;

  const rawAmount = parseMoney(amountMatch[1]);
  if (rawAmount === null || rawAmount === 0) return null;

  // Neste layout, a descrição e a parcela ficam antes da coluna Cidade/País,
  // cujo início é x=428. Assim o município não contamina a regra aprendida.
  const rawDescription = normalize(
    parts
      .filter((part) => part.x > datePart.x && part.x < 428)
      .map((part) => part.text)
      .join(" "),
  );
  if (!rawDescription) return null;

  const descriptionKey = normalize(rawDescription).toUpperCase();
  if (/^(?:TOTAL DA FATURA ANTERIOR|OBRIGADO PELO PAGAMENTO)$/.test(descriptionKey)) {
    return null;
  }

  const installmentMatch = rawDescription.match(INSTALLMENT);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  const description = normalize(rawDescription.replace(INSTALLMENT, ""));
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const amount = amountMatch[2].toUpperCase() === "C" ? -rawAmount : rawAmount;

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

export function parseCaixaInvoice(source: PdfTextLine[]): ParsedInvoice {
  const warnings: string[] = [];
  const dueDate = extractDueDate(source);
  const invoiceTotal = extractInvoiceTotal(source);
  const items: ParsedInvoiceItem[] = [];
  let foundStatement = false;
  let currentCard: string | undefined;

  for (const line of source) {
    const text = normalize(line.text);
    if (/^Demonstrativo$/i.test(text)) {
      foundStatement = true;
      continue;
    }

    const card = text.match(/\(Cartao\s+(\d{4})\)/i);
    if (card) {
      currentCard = card[1];
      continue;
    }

    if (!dueDate) continue;
    const movement = parseMovement(line, dueDate, currentCard);
    if (movement) items.push({ id: items.length + 1, ...movement });
  }

  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!foundStatement) {
    warnings.push('A seção "Demonstrativo" não foi localizada na fatura CAIXA.');
  }
  if (!dueDate) {
    warnings.push("A data de vencimento não foi identificada automaticamente na fatura CAIXA.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout CAIXA.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura CAIXA.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `A soma reconhecida foi R$ ${identifiedTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, enquanto a fatura informa R$ ${invoiceTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    );
  }

  return {
    bank: "CAIXA",
    invoiceTotal,
    dueDate,
    items,
    warnings,
  };
}
