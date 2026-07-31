import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const MONEY_AT_END = /([+-]?)\s*R\$\s*([\d.]+,\d{2})\s*$/i;
const MONEY_GLOBAL = /([+-]?)\s*R\$\s*([\d.]+,\d{2})/gi;
const NUMERIC_DATE = /\b(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\b/;
const PT_DATE_AT_START = /^\s*(\d{1,2})\s+de\s+([a-zç.]+)\s+(20\d{2})\b/i;

const MONTHS: Record<string, string> = {
  jan: "01", janeiro: "01", fev: "02", fevereiro: "02", mar: "03", marco: "03", março: "03",
  abr: "04", abril: "04", mai: "05", maio: "05", jun: "06", junho: "06", jul: "07", julho: "07",
  ago: "08", agosto: "08", set: "09", setembro: "09", out: "10", outubro: "10", nov: "11", novembro: "11",
  dez: "12", dezembro: "12",
};

function normalize(value: string): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function moneyValues(value: string): number[] {
  return [...value.matchAll(MONEY_GLOBAL)].map((match) => {
    const parsed = Number(match[2].replace(/\./g, "").replace(",", "."));
    return match[1] === "-" ? -Math.abs(parsed) : Math.abs(parsed);
  }).filter(Number.isFinite);
}

function parseMoneyAtEnd(value: string): { amount: number; sign: string } | null {
  const match = value.match(MONEY_AT_END);
  if (!match) return null;
  const parsed = Number(match[2].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  return { amount: Math.abs(parsed), sign: match[1] ?? "" };
}

function parseNumericDate(value: string, fallbackYear: number): string | null {
  const match = value.match(NUMERIC_DATE);
  if (!match) return null;
  let year = match[3] ? Number(match[3]) : fallbackYear;
  if (year < 100) year += 2000;
  return `${String(year).padStart(4, "0")}-${match[2]}-${match[1]}`;
}

function parsePortugueseDate(value: string): { iso: string; consumed: string } | null {
  const match = value.match(PT_DATE_AT_START);
  if (!match) return null;
  const month = MONTHS[normalize(match[2]).replace(/\./g, "").toLowerCase()];
  if (!month) return null;
  return { iso: `${match[3]}-${month}-${String(Number(match[1])).padStart(2, "0")}`, consumed: match[0] };
}

function isPaymentDescription(value: string): boolean {
  const key = normalize(value).toUpperCase();
  return key.includes("PAGAMENTO ON LINE")
    || key.includes("PAGAMENTO ONLINE")
    || key.includes("PAGAMENTO DA FATURA")
    || /^PAGAMENTO\b/.test(key);
}

function extractInvoiceTotal(source: PdfTextLine[], identifiedTotal: number): number | null {
  const candidates: number[] = [];
  const firstPages = source.filter((line) => line.page <= 3);

  for (let i = 0; i < firstPages.length; i += 1) {
    const key = normalize(firstPages[i].text).toLowerCase();
    if (!key.includes("total da sua fatura")) continue;

    // Same visual row: choose the value nearest the left-side label when parts are available.
    const parts = firstPages[i].parts ?? [];
    for (const part of parts) {
      if (/limite de credito/i.test(normalize(part.text))) continue;
      candidates.push(...moneyValues(part.text).map(Math.abs));
    }

    // Nearby rows can contain both columns. Keep every candidate and resolve by the sum of transactions.
    for (let j = i; j <= Math.min(i + 5, firstPages.length - 1); j += 1) {
      const nearby = normalize(firstPages[j].text);
      if (/pagamento minimo/i.test(nearby)) break;
      candidates.push(...moneyValues(firstPages[j].text).map(Math.abs));
    }
  }

  // Reliable summary labels elsewhere in the invoice.
  for (const line of source) {
    const key = normalize(line.text).toLowerCase();
    if (/^(fatura atual|despesas do mes)\b/.test(key)) {
      candidates.push(...moneyValues(line.text).map(Math.abs));
    }
  }

  const unique = [...new Set(candidates.filter((value) => value > 0))];
  if (!unique.length) return identifiedTotal > 0 ? Number(identifiedTotal.toFixed(2)) : null;

  // The transaction sum is the strongest discriminator between total and credit limit.
  unique.sort((a, b) => Math.abs(a - identifiedTotal) - Math.abs(b - identifiedTotal));
  return unique[0];
}

function extractDueDate(lines: string[], year: number): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (/data\s+de\s+vencimento|vencimento/i.test(lines[i])) {
      for (let j = i; j <= Math.min(i + 3, lines.length - 1); j += 1) {
        const date = parseNumericDate(lines[j], year);
        if (date) return date;
      }
    }
  }
  return null;
}

function isNoise(line: string): boolean {
  return /^(data\s+movimenta[cç][aã]o|despesas\s+da\s+fatura|benefici[aá]rio|valor|descritivo\s+detalhado)$/i.test(line)
    || /parcelamento\s+da\s+fatura|pagamento\s+m[ií]nimo|limite\s+de\s+cr[eé]dito|c[oó]digo\s+de\s+barras|encargos\s+rotativos|autentica[cç][aã]o\s+mec[aâ]nica/i.test(line);
}

function parseTransactionLine(line: string): { date: string; description: string; amount: number; sign: string; installment?: string } | null {
  const date = parsePortugueseDate(line);
  if (!date) return null;
  const money = parseMoneyAtEnd(line);
  if (!money) return null;

  let middle = line.slice(date.consumed.length).replace(MONEY_AT_END, "").trim();
  middle = middle.replace(/\s+-\s*$/, "").trim();
  const installmentMatch = middle.match(/\(\s*Parcela\s+(\d{1,2})\s+de\s+(\d{1,2})\s*\)/i);
  const installment = installmentMatch ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}` : undefined;
  const description = middle.replace(/\(\s*Parcela\s+\d{1,2}\s+de\s+\d{1,2}\s*\)/i, "").replace(/\s+/g, " ").trim();
  if (!description) return null;
  return { date: date.iso, description, amount: money.amount, sign: money.sign, installment };
}

export function parseInterInvoice(source: PdfTextLine[]): ParsedInvoice {
  const allLines = source.map((entry) => entry.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const yearMatch = allLines.join(" ").match(/\b20\d{2}\b/);
  const fallbackYear = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear();
  const items: ParsedInvoiceItem[] = [];
  const warnings: string[] = [];
  let inExpenses = false;
  let currentCard: string | undefined;

  for (let i = 0; i < allLines.length; i += 1) {
    const line = allLines[i];
    if (/^despesas\s+da\s+fatura$/i.test(line)) { inExpenses = true; continue; }
    if (inExpenses && /^pr[oó]xima\s+fatura$/i.test(line)) break;
    if (!inExpenses) continue;

    const cardMatch = line.match(/^CART[ÃA]O\s+\d{4}\*+(\d{4})$/i);
    if (cardMatch) { currentCard = cardMatch[1]; continue; }
    if (/^Total\s+CART[ÃA]O\b/i.test(line) || isNoise(line)) continue;

    const transaction = parseTransactionLine(line);
    if (!transaction) continue;

    // Credits in this section are payments/adjustments, not expenses of the current invoice.
    if (transaction.sign === "+" || isPaymentDescription(transaction.description)) continue;

    const metadata: string[] = [];
    let lookahead = i + 1;
    while (lookahead < allLines.length) {
      const next = allLines[lookahead];
      if (parsePortugueseDate(next) || /^CART[ÃA]O\s+/i.test(next) || /^Total\s+CART[ÃA]O\b/i.test(next)
        || /^despesas\s+da\s+fatura$/i.test(next) || /^pr[oó]xima\s+fatura$/i.test(next)) break;
      if (/^(Valor e s[ií]mbolo da moeda de origem|Valor em d[oó]lar americano|Cota[cç][aã]o do d[oó]lar americano):/i.test(next)) {
        metadata.push(next); lookahead += 1; continue;
      }
      if (isNoise(next) || /IMPACT HUB|\d{4}\*+\d{4}\s+\d{2}\/\d{2}\/\d{4}/i.test(next)) { lookahead += 1; continue; }
      break;
    }
    i = Math.max(i, lookahead - 1);

    const iof = /^IOF\s+INTERNACIONAL$/i.test(transaction.description);
    const international = !iof && metadata.length > 0;
    items.push({
      id: items.length + 1,
      date: transaction.date,
      description: transaction.installment ? `${transaction.description} ${transaction.installment}` : transaction.description,
      amount: transaction.amount,
      installment: transaction.installment,
      cardLastDigits: currentCard,
      transactionType: iof ? "INTERNATIONAL_IOF" : international ? "INTERNATIONAL_PURCHASE" : transaction.installment ? "INSTALLMENT_PURCHASE" : "PURCHASE",
      exportable: true,
    });
  }

  const exportable = items.filter((item) => item.exportable && !isPaymentDescription(item.description));
  const identifiedTotal = exportable.reduce((sum, item) => sum + item.amount, 0);
  const invoiceTotal = extractInvoiceTotal(source, identifiedTotal);

  if (!inExpenses) warnings.push('A seção "Despesas da fatura" não foi localizada.');
  if (!exportable.length) warnings.push("Nenhum lançamento exportável foi identificado no layout do Banco Inter.");
  if (invoiceTotal !== null && Math.abs(invoiceTotal - identifiedTotal) > 0.009) {
    warnings.push(`A soma dos lançamentos foi R$ ${identifiedTotal.toFixed(2).replace(".", ",")}, diferente do total da fatura.`);
  }

  return { bank: "INTER", invoiceTotal, dueDate: extractDueDate(allLines, fallbackYear), items: exportable, warnings };
}
