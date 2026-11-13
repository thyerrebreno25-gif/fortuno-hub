import { expect, it } from "vitest";
import { meetingOccurrences, recurrenceInput } from "./recurrence";
const start = new Date("2026-11-16T09:00:00-03:00"), end = new Date("2026-11-16T09:30:00-03:00");
it("generates daily occurrences at 9 am Brasília, inclusive of the final date",()=>{
  const dates=meetingOccurrences(start,end,{frequency:"DAILY",weekdays:[],until:"2026-11-18"});
  expect(dates.map(row=>row.startsAt.toISOString())).toEqual(["2026-11-16T12:00:00.000Z","2026-11-17T12:00:00.000Z","2026-11-18T12:00:00.000Z"]);
  expect(dates.every(row=>+row.endsAt-+row.startsAt===30*60000)).toBe(true);
});
it("preserves an overnight duration across month and year boundaries",()=>{
  const dates=meetingOccurrences(new Date("2026-12-31T23:30:00-03:00"),new Date("2027-01-01T00:30:00-03:00"),{frequency:"DAILY",weekdays:[],until:"2027-01-02"});
  expect(dates).toHaveLength(3);expect(dates[2].startsAt.toISOString()).toBe("2027-01-03T02:30:00.000Z");expect(dates[2].endsAt.toISOString()).toBe("2027-01-03T03:30:00.000Z");
});
it("uses selected weekdays only and does not force the base day into the series",()=>{
  const dates=meetingOccurrences(start,end,{frequency:"WEEKLY",weekdays:[4,5],until:"2026-11-20"});
  expect(dates.map(row=>row.startsAt.toISOString().slice(0,10))).toEqual(["2026-11-19","2026-11-20"]);
  expect(recurrenceInput.safeParse({frequency:"WEEKLY",weekdays:[],until:"2026-11-20"}).success).toBe(false);
});
it("rejects invalid dates, empty windows, excessive periods and excessive occurrences",()=>{
  for(const until of ["2026-02-30","2026-11-15","2028-11-20"]) expect(()=>meetingOccurrences(start,end,{frequency:"DAILY",weekdays:[],until})).toThrow();
  expect(()=>meetingOccurrences(start,end,{frequency:"DAILY",weekdays:[],until:"2027-03-01"})).toThrow("100");
  expect(()=>meetingOccurrences(start,end,{frequency:"WEEKLY",weekdays:[0],until:"2026-11-16"})).toThrow("Nenhuma");
});
it("does not repeat an ordinary meeting and keeps Sunday distinct from Monday",()=>{
  expect(meetingOccurrences(start,end)).toEqual([{startsAt:start,endsAt:end}]);
  expect(meetingOccurrences(start,end,{frequency:"WEEKLY",weekdays:[0],until:"2026-11-22"})[0].startsAt.toISOString()).toBe("2026-11-22T12:00:00.000Z");
});
