import {beforeEach,expect,it,vi} from "vitest";
const db=vi.hoisted(()=>({find:vi.fn(),count:vi.fn(),query:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{meetingActionItem:{findMany:db.find,count:db.count},$queryRaw:db.query}}));
import {dailyCarryoverActions,dailyCarryoverCounts,dailyCarryoverWhere} from "./daily-carryover";
const occurrence={id:"today",organizationId:"org",creationKey:"series",type:"Daily",startsAt:new Date("2026-11-18T12:00:00Z"),status:"SCHEDULED",deletedAt:null},now=new Date("2026-11-18T12:30:00Z");
beforeEach(()=>{vi.clearAllMocks();db.find.mockResolvedValue([]);db.count.mockResolvedValue(0);db.query.mockResolvedValue([]);});
it("only includes earlier Dailies of the same tenant and series and preserves completions made during the target day",()=>{
 expect(dailyCarryoverWhere(occurrence,now)).toEqual({meeting:{organizationId:"org",creationKey:"series",type:"Daily",deletedAt:null,status:{not:"CANCELLED"},startsAt:{lt:new Date("2026-11-18T03:00:00Z")}},createdAt:{lt:new Date("2026-11-19T03:00:00Z")},OR:[{completedAt:null},{completedAt:{gte:new Date("2026-11-18T03:00:00Z")}}]});
});
it("waits for the occurrence's Brasília date, including UTC midnight and skipping unrelated or deleted meetings",async()=>{
 expect(dailyCarryoverWhere(occurrence,new Date("2026-11-18T02:59:59Z"))).toBeNull();expect(dailyCarryoverWhere(occurrence,new Date("2026-11-18T03:00:00Z"))).not.toBeNull();
 for(const change of [{type:"Semanal de squad"},{creationKey:null},{deletedAt:now},{status:"CANCELLED"}])expect(dailyCarryoverWhere({...occurrence,...change},now)).toBeNull();
 expect(await dailyCarryoverActions({...occurrence,type:"Semanal de squad"},now)).toEqual({actions:[],total:0});expect(db.find).not.toHaveBeenCalled();
});
it("reads the canonical action and original deadline without copying or moving anything",async()=>{
 const origin={id:"yesterday",title:"Daily | Squad",startsAt:new Date("2026-11-17T12:00:00Z")},action={id:"one-action",meetingId:"yesterday",dueAt:now,autoExtendedAt:now,responsible:{id:"operator"}};
 db.find.mockResolvedValue([{...action,meeting:origin}]);db.count.mockResolvedValue(1);
 expect(await dailyCarryoverActions(occurrence,now)).toEqual({actions:[{...action,origin}],total:1});expect(db.find.mock.calls[0][0].where).toEqual(dailyCarryoverWhere(occurrence,now));
});
it("does not silently truncate inherited activities in reports",async()=>{
 await dailyCarryoverActions(occurrence,now,null);expect(db.find.mock.calls[0][0]).not.toHaveProperty("take");
});
it("aggregates only pending counts for authorized active dates, excluding all future occurrences",async()=>{
 db.query.mockResolvedValue([{id:"today",pending:6}]);expect(await dailyCarryoverCounts([occurrence,{...occurrence,id:"tomorrow",startsAt:new Date("2026-11-19T12:00:00Z")}],now)).toEqual(new Map([["today",6]]));
 const sql=db.query.mock.calls[0][0];expect(sql.values).toEqual(["org","today"]);expect(sql.sql).toContain('a."completedAt" IS NULL');expect(sql.sql).toContain('s."creationKey"=t."creationKey"');expect(sql.sql).toContain("America/Sao_Paulo");
});
