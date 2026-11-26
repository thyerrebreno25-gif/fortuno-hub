import {it,expect,vi} from "vitest";
vi.mock("@/lib/prisma",()=>({prisma:{}}));
import {matchesRecurrence} from "./recurrence";
it("custom recurrence generates only selected weekdays within its date range",()=>{const cfg={startDate:"2026-11-05",endDate:"2026-11-15",weekdays:[1,3,5]};const days=[];for(let d=4;d<=16;d++){const date=new Date(2026,10,d,12);if(matchesRecurrence("CUSTOM",cfg,date))days.push(d);}expect(days).toEqual([6,9,11,13]);});
it("monthly dates recur independently and do not roll a missing day into another month",()=>{
 const cfg={startDate:"2027-01-01",monthDays:[5,20,31]};
 const days=[];for(let day=1;day<=28;day++)if(matchesRecurrence("MONTHLY",cfg,new Date(2027,1,day,12)))days.push(day);
 expect(days).toEqual([5]); // 20/02/2027 is Saturday: no task or anticipation.
 expect(matchesRecurrence("MONTHLY",cfg,new Date(2027,2,31,12))).toBe(true);
 expect(matchesRecurrence("MONTHLY",{...cfg,interval:2},new Date(2027,1,5,12))).toBe(false);
});
