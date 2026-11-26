import {expect,it} from "vitest";
import {nextBusinessRoutine,routineOccurrenceDay,routineHolidayBehavior} from "./routine-calendar";
import {nextOperationBusinessDay} from "./business-days";
it("moves monthly and 15-day occurrences forward, including legacy fortnightly weekly schedules",()=>{
 for(const [type,data] of [["MONTHLY",{}],["DAILY",{interval:15}],["WEEKLY",{interval:2}]] as const){
  expect(nextBusinessRoutine(type,data)).toBe(true);expect(routineHolidayBehavior(type,data)).toBe("NEXT_BUSINESS_DAY");
  expect(routineOccurrenceDay(type,data,"2026-11-28",new Set(["2026-11-30"]))).toBe("2026-12-01");
  expect(routineOccurrenceDay(type,data,"2027-01-01",new Set())).toBe("2027-01-04");
 }
});
it("retains the weekday rules for daily reconciliations and weekly agendas",()=>{
 for(const [type,data] of [["DAILY",{interval:1}],["WEEKLY",{interval:1}],["CUSTOM",{}],["ONCE",{}]] as const){
  expect(routineOccurrenceDay(type,data,"2026-11-28",new Set())).toBeNull();
  expect(routineOccurrenceDay(type,data,"2026-12-25",new Set())).toBe("2026-12-24");
 }
});
it("crosses successive national and local holidays, weekends, months and years",()=>{
 expect(nextOperationBusinessDay("2026-12-25",new Set(["2026-12-28"]))).toBe("2026-12-29");
 expect(nextOperationBusinessDay("2026-12-31",new Set(["2026-12-31"]))).toBe("2027-01-04");
 expect(nextOperationBusinessDay("2026-04-03",new Set())).toBe("2026-04-06");
 expect(nextOperationBusinessDay("2026-11-26",new Set())).toBe("2026-11-26");
});
