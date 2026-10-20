import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const FULL_DATE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const SHORT_DATE = /^(\d{2})\/(\d{2})$/;
const MONEY = /^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;
const INSTALLMENT = /(\d{2})\s*\/\s*(\d{2})/;

type Section = "NONE" | "DOMESTIC" | "INTERNATIONAL" | "PRODUCTS" | "OTHER" | "FINANCE";

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Some Itaú PDFs insert spaces inside words, dates and amounts.
// Compact only structural tokens; preserve the merchant text as extracted.
function compact(value: unknown) { return normalize(value).replace(/\s/g, ""); }

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

function extractDate(source: PdfTextLine[], label: RegExp) {
  for (const line of source) {
    const text = normalize(line.text);
    if (!label.test(text)) continue;
    const match = text.match(FULL_DATE);
    if (match) return toIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return null;
}

function extractInvoiceTotal(source: PdfTextLine[]) {
  for (const line of source) {
    const text = normalize(line.text);
    if (!/^=?Totaldestafatura/i.test(compact(text))) continue;
    const values = (line.parts ?? [])
      .map((part) => parseMoney(part.text))
      .filter((value): value is number => value !== null);
    if (values.length) return Math.abs(values.at(-1)!);
  }
  return null;
}

function splitColumns(source: PdfTextLine[]) {
  const result: PdfTextLine[] = [];
  const pages = [...new Set(source.map((line) => line.page))].sort((left, right) => left - right);

  for (const page of pages) {
    const pageLines = source.filter((line) => line.page === page);
    for (const side of ["left", "right"] as const) {
      for (const line of pageLines) {
        const parts = (line.parts ?? []).filter((part) => side === "left" ? part.x < 350 : part.x >= 350);
        if (!parts.length) continue;
        const text = parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
        if (text) result.push({ page, y: line.y, x: parts[0].x, text, parts });
      }
    }
  }

  return result;
}

function resolveYear(day: number, month: number, closingDate: string) {
  const closingYear = Number(closingDate.slice(0, 4));
  const closingMonth = Number(closingDate.slice(5, 7));
  const closingDay = Number(closingDate.slice(8, 10));
  return month > closingMonth || (month === closingMonth && day > closingDay)
    ? closingYear - 1
    : closingYear;
}

function parseDatedMovement(
  line: PdfTextLine,
  closingDate: string,
  cardLastDigits: string | undefined,
  section: Section,
): Omit<ParsedInvoiceItem, "id"> | null {
  const parts = line.parts ?? [];
  const datePart = parts.find((part) => SHORT_DATE.test(compact(part.text).replace(/^@/, "")));
  const amountPart = [...parts].reverse().find((part) => MONEY.test(compact(part.text)));
  if (!datePart || !amountPart) return null;

  const dateMatch = compact(datePart.text).replace(/^@/, "").match(SHORT_DATE);
  const amount = parseMoney(amountPart.text);
  if (!dateMatch || amount === null || Math.abs(amount) < 0.005) return null;

  const rawDescription = normalize(
    parts
      .filter((part) => part.x > datePart.x && part.x < amountPart.x)
      .map((part) => part.text)
      .join(" "),
  );
  if (!rawDescription) return null;

  const installmentMatch = rawDescription.match(INSTALLMENT);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  const description = normalize(rawDescription.replace(INSTALLMENT, ""));
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);

  return {
    date: toIsoDate(day, month, resolveYear(day, month, closingDate)),
    description,
    amount,
    installment,
    cardLastDigits,
    transactionType: section === "INTERNATIONAL"
      ? "INTERNATIONAL_PURCHASE"
      : installment
        ? "INSTALLMENT_PURCHASE"
        : "PURCHASE",
    exportable: true,
  };
}

function productCard(lines: PdfTextLine[], index: number) {
  const current = lines[index];
  for (let nearby = index + 1; nearby <= Math.min(index + 2, lines.length - 1); nearby += 1) {
    if (lines[nearby].page !== current.page || current.y - lines[nearby].y > 20) break;
    if ((lines[nearby].parts ?? []).some((part) => SHORT_DATE.test(normalize(part.text)))) break;
    const card = normalize(lines[nearby].text).match(/\bTitular\s+(\d{4})\b/i);
    if (card) return card[1];
  }
  return undefined;
}

function specialItem(
  line: PdfTextLine,
  closingDate: string,
  section: Section,
): Omit<ParsedInvoiceItem, "id"> | null {
  const text = normalize(line.text);
  const amount = [...(line.parts ?? [])]
    .reverse()
    .map((part) => parseMoney(part.text))
    .find((value): value is number => value !== null);
  if (amount === undefined || Math.abs(amount) < 0.005) return null;

  if (section === "INTERNATIONAL" && /^RepassedeIOFemR\$/i.test(compact(text))) {
    return {
      date: closingDate,
      description: "REPASSE DE IOF",
      amount,
      transactionType: "INTERNATIONAL_IOF",
      exportable: true,
    };
  }

  if (section === "FINANCE") {
    const names: Record<string, string> = {
      jurosdorotativo: "Juros do rotativo", jurosdemora: "Juros de mora",
      multaporatraso: "Multa por atraso", iofdefinanciamento: "IOF de financiamento",
    };
    const description = (line.parts ?? []).map((part) => names[compact(part.text).toLowerCase()]).find(Boolean);
    if (!description) return null;
    return {
      date: closingDate,
      description,
      amount,
      transactionType: "PURCHASE",
      exportable: true,
    };
  }

  return null;
}

export function isItauAzulLayout(source: PdfTextLine[]) {
  return source.some((line) => /Lancamentos:comprasesaques/i.test(compact(line.text)));
}

export function parseItauAzulInvoice(source: PdfTextLine[]): ParsedInvoice {
  const warnings: string[] = [];
  const dueDate = extractDate(source, /\bVencimento\s*:/i);
  const closingDate = extractDate(source, /\bEmissao\s*:/i) ?? dueDate;
  const invoiceTotal = extractInvoiceTotal(source);
  const lines = splitColumns(source);
  const items: ParsedInvoiceItem[] = [];
  let section: Section = "NONE";
  const maskedCards = [...new Set(source.flatMap((line) => [...compact(line.text).matchAll(/\d{4}\.[X*]{4}\.[X*]{4}\.(\d{4})/gi)].map((match) => match[1])))];
  let currentCard: string | undefined = maskedCards.length === 1 ? maskedCards[0] : undefined;
  let foundTransactions = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = normalize(line.text);

    if (/^Lancamentos:comprasesaques$/i.test(compact(text))) {
      section = "DOMESTIC";
      foundTransactions = true;
      continue;
    }
    if (/^Lancamentosinternacionais$/i.test(compact(text))) {
      section = "INTERNATIONAL";
      continue;
    }
    if (/^Lancamentos:produtoseservicos$/i.test(compact(text))) {
      section = "PRODUCTS";
      continue;
    }
    if (/^Outroslancamentos$/i.test(compact(text))) {
      section = "OTHER";
      continue;
    }
    if (/^Encargoscobradosnestafatura$/i.test(compact(text))) {
      section = "FINANCE";
      continue;
    }
    if (/^(?:Comprasparceladas-proximasfaturas|Limitesdecredito|Fiqueatentoaosencargos|Novotetodejuros)/i.test(compact(text))) {
      section = "NONE";
      continue;
    }

    const card = text.match(/\(final\s+(\d{4})\)/i);
    if (card && !/^Lancamentos no cartao/i.test(text)) {
      currentCard = card[1];
      continue;
    }

    if (!closingDate || section === "NONE") continue;
    const cardLastDigits = section === "PRODUCTS" ? productCard(lines, index) : section === "OTHER" || section === "FINANCE" ? undefined : currentCard;
    const movement = parseDatedMovement(line, closingDate, cardLastDigits, section)
      ?? specialItem(line, closingDate, section);
    if (movement) items.push({ id: items.length + 1, ...movement });
  }

  const identifiedTotal = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  if (!foundTransactions) {
    warnings.push('A seção "Lançamentos: compras e saques" não foi localizada na fatura Itaú/Azul.');
  }
  if (!dueDate) {
    warnings.push("A data de vencimento não foi identificada automaticamente na fatura Itaú/Azul.");
  }
  if (!closingDate) {
    warnings.push("A data de emissão não foi identificada automaticamente na fatura Itaú/Azul.");
  }
  if (!items.length) {
    warnings.push("Nenhum lançamento exportável foi identificado no layout Itaú/Azul.");
  }
  if (invoiceTotal === null) {
    warnings.push("O valor total não foi identificado automaticamente na fatura Itaú/Azul.");
  } else if (Math.abs(invoiceTotal - identifiedTotal) >= 0.01) {
    const balanceLine = source.find((line) => /^(?:S)?Saldofinanciado/i.test(compact(line.text)));
    const balancePart = [...(balanceLine?.parts ?? [])].reverse().find((part) => MONEY.test(compact(part.text)));
    const balance = balancePart ? parseMoney(balancePart.text) : null;
    if (balance !== null && Math.abs(identifiedTotal + balance - invoiceTotal) < 0.01) {
      warnings.push(`A fatura inclui saldo anterior financiado/credor de R$ ${balance.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Esse saldo não foi importado como compra; confira a diferença em relação ao total a pagar.`);
    }

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
