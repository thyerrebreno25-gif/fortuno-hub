import { brazilDay, shiftDay } from "@/modules/operations/analytics";
import type { ExecutivePeriod } from "./types";

export type ExecutivePeriodRange = {
  key: ExecutivePeriod;
  label: string;
  from: string;
  to: string;
  /** Inclusive São Paulo midnight. */
  start: Date;
  /** Exclusive São Paulo midnight after the last included day. */
  end: Date;
  days: Array<{ date: string; label: string }>;
};

export function executivePeriod(requested: string | null | undefined, now = new Date()): ExecutivePeriodRange {
  const key: ExecutivePeriod = requested === "week" || requested === "month" ? requested : "today";
  const to = brazilDay(now);
  const from = key === "week" ? shiftDay(to, -6) : key === "month" ? to.slice(0, 7) + "-01" : to;
  const days: ExecutivePeriodRange["days"] = [];
  for (let cursor = from; cursor <= to; cursor = shiftDay(cursor, 1)) {
    days.push({ date: cursor, label: cursor.slice(8, 10) + "/" + cursor.slice(5, 7) });
  }
  return {
    key,
    label: key === "week" ? "Últimos 7 dias" : key === "month" ? "Este mês" : "Hoje",
    from,
    to,
    start: new Date(from + "T00:00:00-03:00"),
    end: new Date(shiftDay(to, 1) + "T00:00:00-03:00"),
    days,
  };
}

export function managementRole(role: string): boolean {
  return role === "MASTER" || role === "ADMIN" || role === "MANAGER";
}
