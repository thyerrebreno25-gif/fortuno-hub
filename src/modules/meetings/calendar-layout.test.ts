import { expect, it } from "vitest";
import { calendarRange, layoutDay, moveCalendar } from "./calendar-layout";

it("includes the complete week across month and year boundaries in Brasília", () => {
  const range = calendarRange("2027-01-01", "week");
  expect(range.days).toHaveLength(7);
  expect(range.days[0]).toBe("2026-12-27");
  expect(range.to).toBe("2027-01-03T00:00:00-03:00");
});
it("fills the monthly grid with adjacent days and leap day", () => {
  const range = calendarRange("2028-02-15", "month");
  expect(range.days).toContain("2028-02-29");
  expect(range.days.length % 7).toBe(0);
  expect(calendarRange("2028-02-15", "list").days).toHaveLength(29);
});
it("navigates days, weeks, and months without overflowing February", () => {
  expect(moveCalendar("2026-10-31", "day", 1)).toBe("2026-11-01");
  expect(moveCalendar("2026-10-31", "week", 1)).toBe("2026-11-07");
  expect(moveCalendar("2027-01-31", "month", 1)).toBe("2027-02-28");
});
const event = (id: string, start: string, end: string) => ({ id, startsAt: `2026-10-26T${start}:00-03:00`, endsAt: `2026-10-26T${end}:00-03:00`, external: false });
it("places overlapping events side by side and reuses available columns", () => {
  const result = layoutDay([event("a", "09:00", "10:00"), event("b", "09:30", "11:00"), event("c", "10:00", "10:30"), event("d", "12:00", "13:00")], "2026-10-26");
  expect(result.map((entry) => [entry.column, entry.columns])).toEqual([[0, 2], [1, 2], [0, 2], [0, 1]]);
  expect(result[0].top).toBe(540);
});
it("clips overnight events to the visible day and excludes exact midnight endings", () => {
  const result = layoutDay([{ id: "night", external: true, startsAt: "2026-10-25T23:00:00-03:00", endsAt: "2026-10-26T01:00:00-03:00" }, { id: "ended", external: false, startsAt: "2026-10-25T22:00:00-03:00", endsAt: "2026-10-26T00:00:00-03:00" }], "2026-10-26");
  expect(result).toHaveLength(1);
  expect([result[0].top, result[0].bottom]).toEqual([0, 60]);
});
