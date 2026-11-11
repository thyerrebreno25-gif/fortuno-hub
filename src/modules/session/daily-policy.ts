export function sessionDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function signedInToday(lastSignIn: string | undefined, now = new Date()) {
  if (!lastSignIn) return false;
  const at = new Date(lastSignIn);
  return Number.isFinite(at.getTime()) && at.getTime() <= now.getTime()+60000 && sessionDay(at) === sessionDay(now);
}

export function verifiedTotpToday(methods: unknown, now = new Date()) {
  if (!Array.isArray(methods)) return false;
  return methods.some(value => {
    if (!value || typeof value !== "object") return false;
    const entry = value as { method?: string; timestamp?: number };
    if (entry.method !== "totp" || typeof entry.timestamp !== "number") return false;
    const at = new Date(entry.timestamp * 1000);
    return Number.isFinite(at.getTime()) && signedInToday(at.toISOString(), now);
  });
}
