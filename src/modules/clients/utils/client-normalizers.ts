export function cleanDocument(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\D/g, "");
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeDisplayText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}