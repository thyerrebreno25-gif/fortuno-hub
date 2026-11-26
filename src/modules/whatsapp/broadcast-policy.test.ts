import {expect,it} from "vitest";
import {broadcastRecipientsSchema,broadcastScheduleSchema,broadcastScheduleTime,validBroadcastTime} from "./broadcast-policy";
const recipients=(n:number)=>Array.from({length:n},(_,i)=>({clientId:"client"+i,ticketId:"ticket"+i}));
it("supports more than 50 destinations up to 1,000 without duplicate clients or tickets",()=>{
 for(const n of [1,50,51,100,1000])expect(broadcastRecipientsSchema.safeParse(recipients(n)).success).toBe(true);
 for(const rows of [[],recipients(1001),[{clientId:"c",ticketId:"a"},{clientId:"c",ticketId:"b"}],[{clientId:"c",ticketId:"a"},{clientId:"d",ticketId:"a"}]])expect(broadcastRecipientsSchema.safeParse(rows).success).toBe(false);
});
it("interprets the selected wall time in Brasília, independent of the computer timezone",()=>{
 expect(broadcastScheduleTime("2026-11-26T15:30")).toBe("2026-11-26T18:30:00.000Z");expect(broadcastScheduleTime("2026-11-27T00:15")).toBe("2026-11-27T03:15:00.000Z");
 for(const invalid of ["2026-02-30T12:00","bad","2026-11-26T25:00"])expect(broadcastScheduleTime(invalid)).toBeNull();
 const now=new Date("2026-11-26T15:00Z");expect(validBroadcastTime("2026-11-26T15:01Z",now)).toBe(true);expect(validBroadcastTime("2026-11-26T15:00Z",now)).toBe(false);expect(validBroadcastTime("2028-11-26T15:00Z",now)).toBe(false);
});
it("validates the complete scheduled intent before persistence",()=>{
 const input={id:"5d28aa69-d6a3-48ba-a1dd-384084f33a9a",name:"Clientes",content:"Bom dia!",scheduledAt:"2026-11-26T15:30:00-03:00",recipients:recipients(75)};
 expect(broadcastScheduleSchema.safeParse(input).success).toBe(true);expect(broadcastScheduleSchema.safeParse({...input,scheduledAt:"2026-11-26T15:30"}).success).toBe(false);
});
