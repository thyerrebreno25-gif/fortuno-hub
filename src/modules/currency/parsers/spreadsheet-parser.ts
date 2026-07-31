import type { CurrencyTransaction } from "../types";
import { detectCurrency, inferTransactionType } from "../utils/detection";
import { normalizeDate } from "../utils/date";
import { parseCurrencyNumber } from "../utils/number";

type GenericRow = Record<string, unknown>;

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function findKey(keys: string[], terms: string[]): string | undefined {
  return keys.find((key) => {
    const normalized = normalizeHeader(key);
    return terms.some((term) => normalized.includes(term));
  });
}

export async function parseSpreadsheet(
  file: File,
  selectedCurrency: string,
): Promise<CurrencyTransaction[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json<GenericRow>(firstSheet, {
    defval: "",
    raw: true,
  });

  const fallbackYear = new Date().getFullYear();

  return rows
    .map((row, index): CurrencyTransaction | null => {
      const keys = Object.keys(row);
      const dateKey = findKey(keys, [
        "data",
        "date",
        "movimento",
        "competencia",
        "competência",
      ]);
      const descriptionKey = findKey(keys, [
        "descricao",
        "descrição",
        "historico",
        "histórico",
        "observacao",
        "observação",
        "memo",
        "detail",
      ]);
      const amountKey = findKey(keys, [
        "valor",
        "amount",
        "total",
        "usd",
        "eur",
        "gbp",
        "debito",
        "débito",
        "credito",
        "crédito",
      ]);
      const currencyKey = findKey(keys, ["moeda", "currency", "coin"]);

      const joined = Object.values(row).join(" ");
      const date = normalizeDate(dateKey ? row[dateKey] : joined, fallbackYear);
      const description = String(
        descriptionKey ? row[descriptionKey] : joined,
      ).trim();
      const amount = parseCurrencyNumber(amountKey ? row[amountKey] : "");

      if (!date || !amount) return null;

      const currency =
        String(currencyKey ? row[currencyKey] : "").trim().toUpperCase() ||
        detectCurrency(joined) ||
        selectedCurrency;

      const type = inferTransactionType(description, amount);

      return {
        id: crypto.randomUUID(),
        date,
        description: description || `Movimentação ${index + 1}`,
        originalAmount: Math.abs(amount),
        currency,
        rate: null,
        rateDate: null,
        rateSource: null,
        convertedAmount: null,
        type,
        status: "PENDING",
      };
    })
    .filter((row): row is CurrencyTransaction => Boolean(row));
}
