import {expect,it} from "vitest";
import {resetPreservation} from "./reset-preservation";
// Evaluate the Prisma predicates against boundary fixtures, including nullable dates.
function match(row:Record<string,unknown>,where:Record<string,unknown>):boolean{return Object.entries(where).every(([key,value])=>{
 if(key==="AND")return (value as Record<string,unknown>[]).every(w=>match(row,w));
 if(key==="OR")return (value as Record<string,unknown>[]).some(w=>match(row,w));
 if(key==="timeEntries"){const condition=value as {some?:Record<string,unknown>;none?:Record<string,unknown>},rows=row[key] as Record<string,unknown>[];return condition.some?rows.some(r=>match(r,condition.some!)):!rows.some(r=>match(r,condition.none!));}
 if(value&&typeof value==="object"&&!(value instanceof Date)){const v=row[key] as Date|null;return Object.entries(value).every(([op,limit])=>op==="in"?(limit as unknown[]).includes(row[key]):op==="not"?v!==limit:v!==null&&(op==="gte"?+v>=+(limit as Date):+v<+(limit as Date)));}
 return row[key]===value;
});}
const at=(stamp:string)=>new Date(stamp),base={organizationId:"org",deletedAt:null,scheduledDate:null,dueAt:null,createdAt:at("2026-11-01T12:00Z"),timeEntries:[]};
it("preserves today's scheduled tasks in all statuses, Brasília deadlines, new undated work and running timers",()=>{
 const p=resetPreservation("org",at("2026-11-25T15:00Z"));expect(p.day).toBe("2026-11-25");
 for(const row of [
  ...["OPEN","PAUSED","IN_PROGRESS","COMPLETED","DISREGARDED","BLOCKED"].map(status=>({...base,status,scheduledDate:at("2026-11-25T00:00Z")})),
  {...base,scheduledDate:at("2026-11-25T23:59:59.999Z")},
  {...base,scheduledDate:at("2026-11-24T12:00Z"),dueAt:at("2026-11-26T02:59:59Z")},
  {...base,createdAt:at("2026-11-25T03:00Z")},
  {...base,scheduledDate:at("2026-12-01T00:00Z"),timeEntries:[{endedAt:null}]},
 ]){expect(match(row,p.protectedWhere)).toBe(true);expect(match(row,p.removableWhere)).toBe(false);}
});
it("selects previous/future and old undated tasks, excluding other organizations and already archived records",()=>{
 const p=resetPreservation("org",at("2026-11-25T15:00Z"));
 for(const row of [base,{...base,createdAt:at("2026-11-25T02:59:59Z")},{...base,scheduledDate:at("2026-11-24T23:59:59Z")},{...base,scheduledDate:at("2026-11-26T00:00Z")},{...base,dueAt:at("2026-11-26T03:00Z")},{...base,timeEntries:[{endedAt:at("2026-11-24T20:00Z")}]}]){expect(match(row,p.protectedWhere)).toBe(false);expect(match(row,p.removableWhere)).toBe(true);}
 expect(match({...base,organizationId:"other"},p.removableWhere)).toBe(false);expect(match({...base,deletedAt:new Date()},p.removableWhere)).toBe(false);
});
it("uses the Brasília day even before midnight in Brazil and handles month/year boundaries",()=>{
 expect(resetPreservation("org",at("2026-11-26T02:59:59Z")).day).toBe("2026-11-25");expect(resetPreservation("org",at("2026-11-26T03:00Z")).day).toBe("2026-11-26");
 const p=resetPreservation("org",at("2027-01-01T02:00Z"));expect(p.day).toBe("2026-12-31");expect(match({...base,scheduledDate:at("2026-12-31T12:00Z")},p.protectedWhere)).toBe(true);
});
it("future-only cleanup keeps past indicators, today's work, completed tasks and any recorded time",()=>{
 const p=resetPreservation("org",at("2026-11-25T15:00Z")),future={...base,status:"OPEN",scheduledDate:at("2026-11-26T00:00Z")};
 for(const row of [future,{...future,scheduledDate:null,dueAt:at("2026-11-26T03:00Z")}])expect(match(row,p.futureWhere)).toBe(true);
 for(const row of [base,{...future,scheduledDate:at("2026-11-24T00:00Z")},{...future,scheduledDate:at("2026-11-25T00:00Z")},{...future,dueAt:at("2026-11-26T02:59:59Z")},...["COMPLETED","DISREGARDED","IN_PROGRESS"].map(status=>({...future,status})),{...future,timeEntries:[{endedAt:at("2026-11-24T20:00Z")}]},{...future,timeEntries:[{endedAt:null}]},{...future,organizationId:"other"},{...future,deletedAt:new Date()}])expect(match(row,p.futureWhere)).toBe(false);
});
