import * as XLSX from "xlsx";
import type { SalesSpreadsheetEntry, SalesWorkbookPreview } from "./types";

const HEADER_ALIASES = {
  eventDate: ["data ev", "data evento"],
  customer: ["cliente"],
  amount: ["valor"],
  paymentMethod: ["forma de pag", "forma de pagamento"],
  paymentDate: ["data pg", "data pagamento", "data de pagamento"],
  seller: ["vendedor"],
  product: ["produto"],
  documentNumber: ["nfe ou nfce", "nfe nfce", "nota fiscal"],
  destinationLabel: ["cnpj bistro ou doce", "cnpj", "empresa", "cadastro"],
  reconciledMarker: ["conciliado"],
  receiptName: ["nome no comprovante", "nome comprovante"],
} as const;

type HeaderKey = keyof typeof HEADER_ALIASES;

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function money(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/R\$/gi, "").replace(/\s/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function isoDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDateParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? isoDateParts(parsed.y, parsed.m, parsed.d) : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return isoDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return isoDateParts(year, Number(match[2]), Number(match[1]));
}

function headerMap(row: unknown[]) {
  const normalized = row.map(normalize);
  const result = {} as Record<HeaderKey, number>;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as Array<[HeaderKey, readonly string[]]>) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) result[key] = index;
  }
  return result;
}

function findHeader(matrix: unknown[][]) {
  for (let index = 0; index < Math.min(matrix.length, 30); index += 1) {
    const map = headerMap(matrix[index]);
    if (map.amount != null && map.paymentDate != null && map.customer != null) {
      return { rowIndex: index, map };
    }
  }
  return null;
}

export async function parseSalesWorkbook(file: File): Promise<SalesWorkbookPreview> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
    cellFormula: true,
  });

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    });
    const header = findHeader(matrix);
    if (!header) continue;

    const entries: SalesSpreadsheetEntry[] = [];
    let missingPaymentDate = 0;
    let invalidAmount = 0;
    let populatedRows = 0;

    matrix.slice(header.rowIndex + 1).forEach((row, offset) => {
      const sourceRow = header.rowIndex + offset + 2;
      if (!row.some((cell) => cell != null && text(cell))) return;
      populatedRows += 1;
      const amount = money(row[header.map.amount]);
      if (amount == null) {
        invalidAmount += 1;
        return;
      }
      const paymentDate = dateValue(row[header.map.paymentDate]);
      if (!paymentDate) {
        missingPaymentDate += 1;
        return;
      }
      entries.push({
        id: `${sheetName}:${sourceRow}`,
        sourceRow,
        eventDate: header.map.eventDate == null ? null : dateValue(row[header.map.eventDate]),
        customer: header.map.customer == null ? "" : text(row[header.map.customer]),
        amount,
        paymentMethod: header.map.paymentMethod == null ? "" : text(row[header.map.paymentMethod]),
        paymentDate,
        seller: header.map.seller == null ? "" : text(row[header.map.seller]),
        product: header.map.product == null ? "" : text(row[header.map.product]),
        documentNumber: header.map.documentNumber == null ? "" : text(row[header.map.documentNumber]),
        destinationLabel: header.map.destinationLabel == null ? "" : text(row[header.map.destinationLabel]),
        reconciledMarker: header.map.reconciledMarker == null ? "" : text(row[header.map.reconciledMarker]),
        receiptName: header.map.receiptName == null ? "" : text(row[header.map.receiptName]),
      });
    });

    const dates = entries.map((entry) => entry.paymentDate).sort();
    const destinations = Array.from(new Set(entries.map((entry) => entry.destinationLabel || "Sem cadastro informado")))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    const productsByDestination = Object.fromEntries(destinations.map((destination) => [
      destination,
      Array.from(new Set(entries
        .filter((entry) => (entry.destinationLabel || "Sem cadastro informado") === destination)
        .map((entry) => entry.product || "Sem produto informado")))
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    ]));

    return {
      fileName: file.name,
      sheetName,
      totalRows: populatedRows,
      validRows: entries.length,
      missingPaymentDate,
      invalidAmount,
      dateRange: dates.length ? { start: dates[0], end: dates.at(-1)! } : null,
      destinations,
      productsByDestination,
      entries,
    };
  }

  throw new Error("A planilha não contém as colunas DATA PG, CLIENTE e VALOR esperadas.");
}
