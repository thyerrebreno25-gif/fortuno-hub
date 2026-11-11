import {it,expect} from "vitest";
import {sessionDay,signedInToday} from "./daily-policy";
it("uses the calendar day in Brasilia instead of elapsed inactivity or UTC midnight",()=>{const late=new Date("2026-11-12T02:59:59Z");expect(sessionDay(late)).toBe("2026-11-11");expect(signedInToday("2026-11-11T03:01:00Z",late)).toBe(true);expect(signedInToday("2026-11-11T03:01:00Z",new Date("2026-11-12T03:00:00Z"))).toBe(false);});
it("rejects missing, invalid and future sign-in timestamps",()=>{const now=new Date("2026-11-11T15:00:00Z");for(const value of [undefined,"oops","2026-11-12T15:00:00Z"])expect(signedInToday(value,now)).toBe(false);});
