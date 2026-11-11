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
