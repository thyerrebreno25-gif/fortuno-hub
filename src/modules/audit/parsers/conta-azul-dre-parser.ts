import type { AuditDreRow } from "../types";

type PdfTextItem = {
  str: string;
  transform: number[];
};

type Positioned = {
  x: number;
  y: number;
  text: string;
};

type Row = {
  y: number;
  items: Positioned[];
};

export type ParsedContaAzulDre = {
  company: string | null;
  months: string[];
  periodStart: string | null;
  periodEnd: string | null;
  rows: AuditDreRow[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function parseMoney(value: string) {
  const raw = clean(value);
  if (!/^-?\s*\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\s*\d+,\d{2}$/.test(raw)) {
    return null;
  }

  const parsed = Number(raw.replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function monthKey(value: string) {
  const months: Record<string, string> = {
    JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06",
    JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12",
  };
  const match = normalize(value).match(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4})\b/);
  return match ? `${match[2]}-${months[match[1]]}` : null;
}

function isoDate(value: string) {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function clusterRows(items: Positioned[]) {
  const rows: Row[] = [];

  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => ({ ...row, items: row.items.sort((a, b) => a.x - b.x) }));
}

function categoryLevel(x: number) {
  if (x < 35) return 0;
  if (x < 41) return 1;
  return 2;
}

export async function parseContaAzulDre(file: File): Promise<ParsedContaAzulDre> {
  if (!file?.name?.toLowerCase().endsWith(".pdf")) {
    throw new Error("A DRE Gerencial deve ser importada em PDF.");
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    typeof window === "undefined"
      ? "../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"
      : "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const parsedRows: AuditDreRow[] = [];
  const detectedMonths = new Set<string>();
  let company: string | null = null;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned: Positioned[] = [];

    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as PdfTextItem;
      const text = clean(item.str);
      if (!text) continue;
      positioned.push({ x: Number(item.transform[4]), y: Number(item.transform[5]), text });
    }

    const pageText = positioned.map((item) => item.text).join(" ");
    if (!company && pageNumber === 1) {
      company = positioned.find((item) => /LTDA|S\/A|EIRELI|MEI\b/i.test(item.text))?.text ?? null;
    }
    if (!periodStart || !periodEnd) {
      const period = pageText.match(/Per[ií]odo:\s*de\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (period) {
        periodStart = isoDate(period[1]);
        periodEnd = isoDate(period[2]);
      }
    }

    const rows = clusterRows(positioned);
    const header = rows.find((row) => row.items.some((item) => normalize(item.text) === "CATEGORIA"));
    if (!header) continue;

    const monthHeaders = header.items
      .map((item) => ({ ...item, key: monthKey(item.text) }))
      .filter((item): item is Positioned & { key: string } => Boolean(item.key))
      .sort((a, b) => a.x - b.x);
    if (monthHeaders.length < 2) continue;
    monthHeaders.forEach((item) => detectedMonths.add(item.key));
    const firstMonthX = monthHeaders[0].x;

    for (const row of rows) {
      if (row.y >= header.y - 3) continue;
      const categoryItems = row.items.filter((item) => item.x < firstMonthX - 15);
      const category = clean(categoryItems.map((item) => item.text).join(" "));
      if (!category || normalize(category) === "SEM LANCAMENTOS") continue;

      const amounts = row.items
        .filter((item) => item.x >= firstMonthX - 5)
        .map((item) => parseMoney(item.text))
        .filter((value): value is number => value !== null);
      if (amounts.length < monthHeaders.length) continue;

      const values: Record<string, number> = {};
      monthHeaders.forEach((month, index) => { values[month.key] = amounts[index]; });
      parsedRows.push({
        category,
        values,
        level: categoryLevel(categoryItems[0]?.x ?? 44),
        sourcePage: pageNumber,
        sourceText: row.items.map((item) => item.text).join(" | "),
      });
    }
  }

  const months = [...detectedMonths].sort();
  if (months.length < 2 || !parsedRows.length) {
    throw new Error("O PDF foi aberto, mas o layout da DRE Gerencial do Conta Azul não foi identificado.");
  }

  const unique = new Map<string, AuditDreRow>();
  for (const row of parsedRows) {
    const key = `${normalize(row.category)}|${months.map((month) => row.values[month] ?? 0).join("|")}`;
    if (!unique.has(key)) unique.set(key, row);
  }

  return { company, months, periodStart, periodEnd, rows: [...unique.values()] };
}
