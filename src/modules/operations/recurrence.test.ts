import {it,expect,vi} from "vitest";
vi.mock("@/lib/prisma",()=>({prisma:{}}));
import {matchesRecurrence} from "./recurrence";
it("custom recurrence generates only selected weekdays within its date range",()=>{const cfg={startDate:"2026-11-05",endDate:"2026-11-15",weekdays:[1,3,5]};const days=[];for(let d=4;d<=16;d++){const date=new Date(2026,10,d,12);if(matchesRecurrence("CUSTOM",cfg,date))days.push(d);}expect(days).toEqual([6,9,11,13]);});
