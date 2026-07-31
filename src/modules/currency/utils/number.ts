export function parseCurrencyNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[^\d,.\-+]/g, "");

  if (!text) return 0;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma > lastDot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    text = text.replace(/,/g, "");
  } else {
    text = text.replace(",", ".");
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value);
}
