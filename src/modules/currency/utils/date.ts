const MONTHS: Record<string, number> = {
  JAN: 1,
  JANEIRO: 1,
  FEV: 2,
  FEVEREIRO: 2,
  FEB: 2,
  FEBRUARY: 2,
  MAR: 3,
  MARCO: 3,
  MARÇO: 3,
  MARCH: 3,
  ABR: 4,
  ABRIL: 4,
  APR: 4,
  APRIL: 4,
  MAI: 5,
  MAIO: 5,
  MAY: 5,
  JUN: 6,
  JUNHO: 6,
  JUNE: 6,
  JUL: 7,
  JULHO: 7,
  JULY: 7,
  AGO: 8,
  AGOSTO: 8,
  AUG: 8,
  AUGUST: 8,
  SET: 9,
  SETEMBRO: 9,
  SEP: 9,
  SEPTEMBER: 9,
  OUT: 10,
  OUTUBRO: 10,
  OCT: 10,
  OCTOBER: 10,
  NOV: 11,
  NOVEMBRO: 11,
  NOVEMBER: 11,
  DEZ: 12,
  DEZEMBRO: 12,
  DEC: 12,
  DECEMBER: 12,
};

function validIsoDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeMonthToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function normalizeDate(
  value: unknown,
  fallbackYear = new Date().getFullYear(),
): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "number" && value > 20000) {
    const utcDays = Math.floor(value - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    return date.toISOString().slice(0, 10);
  }

  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return null;

  const iso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (iso) {
    const result = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return validIsoDate(result) ? result : null;
  }

  const br = text.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/);
  if (br) {
    const year = br[3]
      ? br[3].length === 2
        ? `20${br[3]}`
        : br[3]
      : String(fallbackYear);

    const result = `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    return validIsoDate(result) ? result : null;
  }

  // Aceita formatos como:
  // 31 MAR 2026
  // 31 MARÇO 2026
  // 31 de março de 2026
  // 31 March 2026
  const named = text.match(
    /\b(\d{1,2})\s*(?:DE\s+)?([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,10})\s*(?:DE\s+)?(20\d{2})?\b/,
  );

  if (named) {
    const monthToken = normalizeMonthToken(named[2]);
    const month = MONTHS[named[2]] ?? MONTHS[monthToken];

    if (!month) return null;

    const result = `${named[3] ?? fallbackYear}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    return validIsoDate(result) ? result : null;
  }

  return null;
}

export function formatDateBR(value: string | null): string {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
