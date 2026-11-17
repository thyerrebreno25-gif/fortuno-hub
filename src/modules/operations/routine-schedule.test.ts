import { expect, it } from "vitest";
import { routineScheduleKey, routineScheduleLabel } from "./routine-schedule";
it("keeps weekdays, periods and deadlines independent",()=>{
  const base={startDate:"2026-11-16",weekdays:[1],dueTime:"18:00"};
  for(const patch of [{weekdays:[2]},{dueTime:"17:00"},{endDate:"2026-12-01"},{startDate:"2026-11-23"},{interval:2}])expect(routineScheduleKey("WEEKLY",base)).not.toBe(routineScheduleKey("WEEKLY",{...base,...patch}));
});
it("treats reordered weekdays and equivalent defaults as the same schedule",()=>expect(routineScheduleKey("WEEKLY",{weekdays:[3,1,3]})).toBe(routineScheduleKey("WEEKLY",{weekdays:[1,3],dueTime:"18:00",interval:1,holidayBehavior:"KEEP"})));
it("ignores unused form weekdays for a business-day routine",()=>expect(routineScheduleKey("DAILY",{dailyMode:"BUSINESS_DAYS",weekdays:[1]})).toBe(routineScheduleKey("DAILY",{dailyMode:"BUSINESS_DAYS",weekdays:[2]})));
it("shows days and deadline for independent routines in the list",()=>expect(routineScheduleLabel("WEEKLY",{weekdays:[2,1],dueTime:"09:00"})).toBe("Seg, Ter · 09:00"));
