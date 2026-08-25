import type { ParsedInvoice, ParsedInvoiceItem } from "./types";

export type InvoiceImageTextLine = {
  text: string;
  x: number;
  y: number;
};

export type InvoiceImagePage = {
  name: string;
  text: string;
  lines: InvoiceImageTextLine[];
};

type ParsedImageItem = Omit<ParsedInvoiceItem, "id">;

type ImageRow = {
  text: string;
  y: number;
};

const NUMERIC_DATE_AT_START =
  /^\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})(?:\s*[\/.\-]\s*(\d{2,4}))?\b/;
const PORTUGUESE_DATE_AT_START =
  /^\s*(\d{1,2})\s+de\s+([a-zç.]+)(?:\s+(20\d{2}))?\b/i;
const MONEY_AT_END =
  /([+\-−–—]?)\s*(?:R\$\s*)?([\d.]+,\d{2})\s*([CD])?\s*$/i;
const PORTUGUESE_MONTHS: Record<string, number> = {
  jan: 1,
  janeiro: 1,
  fev: 2,
  fevereiro: 2,
  mar: 3,
  marco: 3,
  abr: 4,
  abril: 4,
  mai: 5,
  maio: 5,
  jun: 6,
  junho: 6,
  jul: 7,
  julho: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  setembro: 9,
  out: 10,
  outubro: 10,
  nov: 11,
  novembro: 11,
  dez: 12,
  dezembro: 12,
};

function cleanText(value: string) {
  return String(value ?? "")
    .replace(/[|]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function groupVisualRows(lines: InvoiceImageTextLine[]): ImageRow[] {
  const ordered = lines
    .map((line) => ({ ...line, text: cleanText(line.text) }))
    .filter((line) => line.text)
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const groups: Array<{ y: number; lines: InvoiceImageTextLine[] }> = [];

  for (const line of ordered) {
    const current = groups.at(-1);
    if (current && Math.abs(current.y - line.y) <= 0.009) {
      current.lines.push(line);
      current.y = current.lines.reduce((sum, item) => sum + item.y, 0) / current.lines.length;
    } else {
      groups.push({ y: line.y, lines: [line] });
    }
  }

  return groups.map((group) => ({
    y: group.y,
    text: group.lines
      .sort((left, right) => left.x - right.x)
      .map((line) => line.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  }));
}

function parseFullDate(value: string): Date | null {
  const match = value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  const month = Number(match[2]);
  const day = Number(match[1]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function toIsoDate(day: number, month: number, year: number) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function inferReferenceDate(pages: InvoiceImagePage[], now: Date) {
  const text = pages.map((page) => page.text).join("\n");
  const dueMatch = text.match(
    /(?:venc(?:imento)?\.?|vence(?:\s+em)?)[^\d]{0,20}(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  );
  const dueDate = dueMatch ? parseFullDate(dueMatch[1]) : null;
  const explicitYear = text.match(/\b(20\d{2})\b/);
  return {
    dueDate,
    year: dueDate?.getUTCFullYear() ?? Number(explicitYear?.[1] ?? now.getFullYear()),
    month: dueDate ? dueDate.getUTCMonth() + 1 : now.getMonth() + 1,
  };
}

function extractHeaderTotal(pages: InvoiceImagePage[]) {
  for (const page of pages) {
    const match = page.text.match(
      /(?:valor\s+total|total\s+(?:da|desta|de\s+sua)\s+fatura|fatura\s+fechada\s+total)[\s\S]{0,90}?R\$\s*([\d.]+,\d{2})/i,
    );
    if (!match) continue;
    const parsed = Number(match[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isPayment(value: string) {
  const key = normalize(value);
  return /PAGAMENTO.*FATURA|PAGAMENTO ON ?LINE|DEBITO AUTOMATICO.*FATURA/.test(key);
}

function isCredit(value: string, sign: string, suffix: string) {
  if (sign === "-" || suffix.toUpperCase() === "C") return true;
  return /\b(ESTORNO|CREDITO|CANCELAMENTO|REEMBOLSO)\b/.test(normalize(value));
}

function readRowDate(
  value: string,
  referenceYear: number,
  referenceMonth: number,
) {
  const numeric = value.match(NUMERIC_DATE_AT_START);
  const portuguese = value.match(PORTUGUESE_DATE_AT_START);
  if (!numeric && !portuguese) return null;

  const day = Number((numeric ?? portuguese)![1]);
  const month = numeric
    ? Number(numeric[2])
    : PORTUGUESE_MONTHS[
        normalize(portuguese![2]).replace(/\./g, "").toLowerCase()
      ];
  let year = Number(numeric?.[3] ?? portuguese?.[3] ?? referenceYear);
  if (year < 100) year += 2000;
  if (!numeric?.[3] && !portuguese?.[3] && month > referenceMonth) year -= 1;
  const date = toIsoDate(day, month, year);
  return date
    ? { date, consumed: (numeric ?? portuguese)![0] }
    : null;
}

function isDatedRow(value: string) {
  return NUMERIC_DATE_AT_START.test(value) || PORTUGUESE_DATE_AT_START.test(value);
}

function parseRow(
  row: ImageRow,
  followingRows: ImageRow[],
  referenceYear: number,
  referenceMonth: number,
): ParsedImageItem | null {
  const parsedDate = readRowDate(row.text, referenceYear, referenceMonth);
  const moneyMatch = row.text.match(MONEY_AT_END);
  if (!parsedDate || !moneyMatch) return null;

  let description = cleanText(
    row.text.slice(parsedDate.consumed.length, moneyMatch.index).replace(/^[\-:]+|[\-:]+$/g, ""),
  );
  const installmentMatch = description.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  const installment = installmentMatch
    ? `${Number(installmentMatch[1])}/${Number(installmentMatch[2])}`
    : undefined;
  if (installmentMatch) {
    description = cleanText(description.replace(installmentMatch[0], ""));
  }
  if (description.length < 2 || isPayment(description)) return null;

  const parsedAmount = Number(moneyMatch[2].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(parsedAmount) || parsedAmount === 0) return null;
  const credit = isCredit(description, moneyMatch[1] ?? "", moneyMatch[3] ?? "");
  const international = followingRows.some((item) =>
    /\bUSD\b|CONVERS[AÃ]O.*D[ÓO]LAR|\bIOF\b/i.test(item.text),
  );

  return {
    date: parsedDate.date,
    description,
    amount: credit ? -Math.abs(parsedAmount) : Math.abs(parsedAmount),
    installment,
    transactionType: international
      ? "INTERNATIONAL_PURCHASE"
      : installment
        ? "INSTALLMENT_PURCHASE"
        : "PURCHASE",
    exportable: true,
  };
}

function descriptionSimilarity(left: string, right: string) {
  const a = normalize(left).replace(/[^A-Z0-9]+/g, " ").trim();
  const b = normalize(right).replace(/[^A-Z0-9]+/g, " ").trim();
  if (a === b) return 1;
  if (!a || !b) return 0;
  const bigrams = (value: string) => {
    const compact = value.replace(/\s+/g, " ");
    const result = new Map<string, number>();
    for (let index = 0; index < compact.length - 1; index += 1) {
      const pair = compact.slice(index, index + 2);
      result.set(pair, (result.get(pair) ?? 0) + 1);
    }
    return result;
  };
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  let intersection = 0;
  for (const [pair, count] of leftPairs) {
    intersection += Math.min(count, rightPairs.get(pair) ?? 0);
  }
  const leftCount = [...leftPairs.values()].reduce((sum, count) => sum + count, 0);
  const rightCount = [...rightPairs.values()].reduce((sum, count) => sum + count, 0);
  return (2 * intersection) / Math.max(1, leftCount + rightCount);
}

function deduplicateOverlappingPages(pageItems: ParsedImageItem[][]) {
  type ItemGroup = { representative: ParsedImageItem; maximumOccurrences: number };
  const groups: ItemGroup[] = [];
  let totalRead = 0;

  for (const items of pageItems) {
    totalRead += items.length;
    const pageGroups: Array<{ representative: ParsedImageItem; count: number }> = [];
    for (const item of items) {
      const existing = pageGroups.find((candidate) =>
        candidate.representative.date === item.date &&
        candidate.representative.amount === item.amount &&
        candidate.representative.installment === item.installment &&
        descriptionSimilarity(candidate.representative.description, item.description) >= 0.88,
      );
      if (existing) existing.count += 1;
      else pageGroups.push({ representative: item, count: 1 });
    }

    for (const pageGroup of pageGroups) {
      const existing = groups.find((candidate) =>
        candidate.representative.date === pageGroup.representative.date &&
        candidate.representative.amount === pageGroup.representative.amount &&
        candidate.representative.installment === pageGroup.representative.installment &&
        descriptionSimilarity(
          candidate.representative.description,
          pageGroup.representative.description,
        ) >= 0.88,
      );
      if (existing) {
        existing.maximumOccurrences = Math.max(existing.maximumOccurrences, pageGroup.count);
      } else {
        groups.push({
          representative: pageGroup.representative,
          maximumOccurrences: pageGroup.count,
        });
      }
    }
  }

  const items = groups.flatMap((group) =>
    Array.from({ length: group.maximumOccurrences }, () => ({ ...group.representative })),
  );
  return { items, removed: totalRead - items.length };
}

export function parseInvoiceImagePages(
  pages: InvoiceImagePage[],
  bank: string,
  now = new Date(),
): ParsedInvoice {
  const reference = inferReferenceDate(pages, now);
  const warnings: string[] = [];
  const parsedPages = pages.map((page) => {
    const rows = groupVisualRows(page.lines);
    const items: ParsedImageItem[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const nextDatedRow = rows.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && isDatedRow(candidate.text),
      );
      const end = nextDatedRow > index ? nextDatedRow : rows.length;
      const parsed = parseRow(
        rows[index],
        rows.slice(index + 1, end),
        reference.year,
        reference.month,
      );
      if (parsed) items.push(parsed);
    }
    if (!items.length) {
      warnings.push(`Nenhum lançamento seguro foi identificado em ${page.name}.`);
    }
    return items;
  });

  const deduplicated = deduplicateOverlappingPages(parsedPages);
  const items = deduplicated.items.map((item, index) => ({ ...item, id: index + 1 }));
  if (!items.length) {
    throw new Error(
      "O OCR abriu as imagens, mas não encontrou linhas completas com data, descrição e valor.",
    );
  }
  if (deduplicated.removed > 0) {
    warnings.push(
      `${deduplicated.removed} lançamento(s) repetido(s) em áreas sobrepostas dos prints foram removidos.`,
    );
  }

  if (!reference.dueDate) {
    warnings.push(
      "O vencimento não apareceu nos prints. Confira as datas antes de exportar.",
    );
  }

  const identifiedTotal = Number(
    items.reduce((sum, item) => sum + item.amount, 0).toFixed(2),
  );
  const headerTotal = extractHeaderTotal(pages);
  if (headerTotal === null) {
    warnings.push(
      "Importação parcial por imagem: a conferência considera somente a soma dos lançamentos presentes nos prints.",
    );
  } else if (Math.abs(headerTotal - identifiedTotal) >= 0.01) {
    warnings.push(
      `Os prints informam uma fatura de R$ ${formatMoney(headerTotal)}, mas contêm R$ ${formatMoney(identifiedTotal)} em lançamentos. A importação continuará somente com os itens presentes nas imagens.`,
    );
  }

  return {
    bank,
    invoiceTotal: identifiedTotal,
    dueDate: reference.dueDate?.toISOString().slice(0, 10) ?? null,
    items,
    warnings,
  };
}
