export type CalendarView = "day" | "week" | "month" | "list";
const DAY = 86400000;
export const calendarDate = (key: string) => new Date(`${key}T12:00:00Z`);
export const shiftDay = (key: string, amount: number) => new Date(+calendarDate(key) + amount * DAY).toISOString().slice(0, 10);
export const dayStart = (key: string) => +new Date(`${key}T00:00:00-03:00`);

export function calendarRange(anchor: string, view: CalendarView) {
  let start = anchor;
  let count = 1;
  if (view === "week") {
    start = shiftDay(anchor, -calendarDate(anchor).getUTCDay());
    count = 7;
  } else if (view === "month" || view === "list") {
    start = `${anchor.slice(0, 7)}-01`;
    const date = calendarDate(start);
    count = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    if (view === "month") {
      const offset = date.getUTCDay();
      start = shiftDay(start, -offset);
      count = Math.ceil((count + offset) / 7) * 7;
    }
  }
  return {
    days: Array.from({ length: count }, (_, index) => shiftDay(start, index)),
    from: `${start}T00:00:00-03:00`,
    to: `${shiftDay(start, count)}T00:00:00-03:00`,
  };
}

export function moveCalendar(anchor: string, view: CalendarView, amount: number) {
  if (view === "day" || view === "week") return shiftDay(anchor, amount * (view === "week" ? 7 : 1));
  const date = calendarDate(anchor);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

type TimedEvent = { id: string; startsAt: string; endsAt: string; external: boolean };
// Divide simultaneous events into columns, including chains of overlapping intervals.
export function layoutDay<T extends TimedEvent>(events: T[], key: string) {
  const start = dayStart(key), end = start + DAY;
  const entries = events.filter((event) => +new Date(event.startsAt) < end && +new Date(event.endsAt) > start)
    .map((event) => {
      const top = Math.max(0, (+new Date(event.startsAt) - start) / 60000);
      const bottom = Math.min(1440, (+new Date(event.endsAt) - start) / 60000);
      return { event, top, bottom, column: 0, columns: 1, visualBottom: Math.min(1440, Math.max(bottom, top + 24)) };
    }).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  let group: typeof entries = [], groupEnd = -1;
  const finish = () => {
    const columns = Math.max(1, ...group.map((entry) => entry.column + 1));
    group.forEach((entry) => { entry.columns = columns; });
    group = [];
  };
  for (const entry of entries) {
    if (entry.top >= groupEnd) finish();
    const occupied = new Set(group.filter((other) => other.visualBottom > entry.top).map((other) => other.column));
    while (occupied.has(entry.column)) entry.column++;
    group.push(entry);
    groupEnd = Math.max(...group.map((other) => other.visualBottom));
  }
  finish();
  return entries;
}
