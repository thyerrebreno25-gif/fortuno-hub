export type DashboardPeriodCode = "7D" | "30D" | "6M" | "12M";

export type DashboardUsageKind =
  | "EXCHANGE"
  | "BANK_STATEMENT"
  | "ACQUIRER"
  | "CREDIT_CARD_INVOICE"
  | "BRASILMED_RECONCILIATION"
  | "PURCHASE_INVOICE_IMPORT"
  | "CA_ACQUIRER"
  | "CA_CREDIT_CARD_INVOICE"
  | "CA_PURCHASE_INVOICE";

export type DashboardUsageEvent = {
  id: string;
  kind: DashboardUsageKind;
  stage: "IMPORT" | "CA_EXPORT";
  occurredAt: string;
  clientId: string | null;
  clientName: string | null;
  userId: string;
  userName: string;
  status: string;
  successful: boolean;
  entries: number;
  amount: number;
};

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

const periodLabels: Record<DashboardPeriodCode, string> = {
  "7D": "Últimos 7 dias",
  "30D": "Últimos 30 dias",
  "6M": "Últimos 6 meses",
  "12M": "Últimos 12 meses",
};

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function shiftDays(value: string, amount: number) {
  const date = dateFromKey(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function shiftMonths(value: string, amount: number) {
  const date = dateFromKey(`${value.slice(0, 7)}-01`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(start: string, end: string) {
  return Math.floor((dateFromKey(end).getTime() - dateFromKey(start).getTime()) / 86_400_000) + 1;
}

function monthKeys(start: string, end: string) {
  const keys: string[] = [];
  let cursor = `${start.slice(0, 7)}-01`;
  const finalMonth = end.slice(0, 7);
  while (cursor.slice(0, 7) <= finalMonth && keys.length < 24) {
    keys.push(cursor.slice(0, 7));
    cursor = shiftMonths(cursor, 1);
  }
  return keys;
}

export function resolveDashboardPeriod(
  requested: string | null | undefined,
  now = new Date(),
) {
  const code: DashboardPeriodCode = requested === "7D"
    || requested === "6M"
    || requested === "12M"
    ? requested
    : "30D";
  const endKey = dateKey(now);
  const startKey = code === "7D"
    ? shiftDays(endKey, -6)
    : code === "30D"
      ? shiftDays(endKey, -29)
      : code === "6M"
        ? shiftMonths(`${endKey.slice(0, 7)}-01`, -5)
        : shiftMonths(`${endKey.slice(0, 7)}-01`, -11);
  return {
    code,
    label: periodLabels[code],
    startKey,
    endKey,
    start: new Date(`${startKey}T00:00:00-03:00`),
    end: now,
    dayCount: daysInclusive(startKey, endKey),
    monthCount: monthKeys(startKey, endKey).length,
    granularity: code === "7D" || code === "30D" ? "DAY" as const : "MONTH" as const,
  };
}

type AggregateRow = {
  key: string;
  label: string;
  total: number;
  imports: number;
  caSends: number;
  caEntries: number;
  amount: number;
};

function increment(
  map: Map<string, AggregateRow>,
  key: string,
  label: string,
  event: DashboardUsageEvent,
) {
  const current = map.get(key) ?? {
    key,
    label,
    total: 0,
    imports: 0,
    caSends: 0,
    caEntries: 0,
    amount: 0,
  };
  current.total += 1;
  current.imports += event.stage === "IMPORT" ? 1 : 0;
  current.caSends += event.stage === "CA_EXPORT" && event.successful ? 1 : 0;
  current.caEntries += event.stage === "CA_EXPORT" ? event.entries : 0;
  current.amount += Math.abs(event.amount || 0);
  map.set(key, current);
}

export function buildDashboardUsage(
  events: DashboardUsageEvent[],
  period: ReturnType<typeof resolveDashboardPeriod>,
) {
  const filtered = events.filter((event) => {
    const key = dateKey(new Date(event.occurredAt));
    return key >= period.startKey && key <= period.endKey;
  });
  const byType = new Map<string, AggregateRow>();
  const byClient = new Map<string, AggregateRow>();
  const byUser = new Map<string, AggregateRow>();

  filtered.forEach((event) => {
    increment(byType, event.kind, event.kind, event);
    if (event.clientId) increment(byClient, event.clientId, event.clientName || "Cliente sem nome", event);
    increment(byUser, event.userId, event.userName, event);
  });

  const timelineKeys = period.granularity === "DAY"
    ? Array.from({ length: period.dayCount }, (_, index) => shiftDays(period.startKey, index))
    : monthKeys(period.startKey, period.endKey);
  const timeline = new Map(timelineKeys.map((key) => [key, {
    key,
    total: 0,
    imports: 0,
    caSends: 0,
    caEntries: 0,
  }]));
  filtered.forEach((event) => {
    const day = dateKey(new Date(event.occurredAt));
    const key = period.granularity === "DAY" ? day : day.slice(0, 7);
    const item = timeline.get(key);
    if (!item) return;
    item.total += 1;
    item.imports += event.stage === "IMPORT" ? 1 : 0;
    item.caSends += event.stage === "CA_EXPORT" && event.successful ? 1 : 0;
    item.caEntries += event.stage === "CA_EXPORT" ? event.entries : 0;
  });

  const successfulSends = filtered.filter((event) => event.stage === "CA_EXPORT" && event.successful);
  const imports = filtered.filter((event) => event.stage === "IMPORT");
  const uniqueClients = new Set(filtered.flatMap((event) => event.clientId ? [event.clientId] : []));
  return {
    totalActivities: filtered.length,
    activitiesToday: filtered.filter((event) => dateKey(new Date(event.occurredAt)) === period.endKey).length,
    imports: imports.length,
    caSends: successfulSends.length,
    caEntries: successfulSends.reduce((sum, event) => sum + event.entries, 0),
    importedAmount: imports.reduce((sum, event) => sum + Math.abs(event.amount || 0), 0),
    sentAmount: successfulSends.reduce((sum, event) => sum + Math.abs(event.amount || 0), 0),
    clients: uniqueClients.size,
    dailyAverage: period.dayCount ? filtered.length / period.dayCount : 0,
    monthlyAverage: period.monthCount ? filtered.length / period.monthCount : 0,
    timeline: [...timeline.values()],
    byType: [...byType.values()].sort((left, right) => right.total - left.total),
    byClient: [...byClient.values()].sort((left, right) => right.total - left.total).slice(0, 12),
    byUser: [...byUser.values()].sort((left, right) => right.total - left.total).slice(0, 12),
    recent: [...filtered].sort((left, right) => (
      new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
    )).slice(0, 12),
  };
}
