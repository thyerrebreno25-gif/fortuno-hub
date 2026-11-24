import { expect, it } from "vitest";
import { endOfDayWindow } from "./end-of-day-policy";
it("opens at 17h30 in Sao Paulo, never before",()=>{
  expect(endOfDayWindow(new Date("2026-11-16T20:29:59Z")).due).toBe(false);
  expect(endOfDayWindow(new Date("2026-11-16T20:30:00Z")).due).toBe(true);
});
it("remains available for late arrivals and uses the local day across UTC midnight",()=>{
  const w=endOfDayWindow(new Date("2026-11-17T01:00:00Z"));expect(w).toMatchObject({day:"2026-11-16",tomorrow:"2026-11-17",due:true});
  expect(w.end.toISOString()).toBe("2026-11-17T03:00:00.000Z");
  expect(w.tomorrowEnd.toISOString()).toBe("2026-11-18T03:00:00.000Z");
});
it("never interrupts weekends or the next morning",()=>{
  for(const date of ["2026-11-14T21:00:00Z","2026-11-15T21:00:00Z","2026-11-17T03:00:00Z"])expect(endOfDayWindow(new Date(date)).due).toBe(false);
});
