import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),rows:vi.fn(),update:vi.fn(),generate:vi.fn()}));
vi.mock("@/modules/operations/auth",()=>({getOperationMember:m.member,canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/lib/prisma",()=>({prisma:{operationClientProcess:{findMany:m.rows,updateMany:m.update}}}));
vi.mock("@/modules/operations/recurrence",()=>({generateActivitiesForConfigurationRange:m.generate}));
import {POST} from "./route";
const request=(body:object={})=>new Request("https://hub.test/calendar-refresh",{method:"POST",body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();m.member.mockResolvedValue({userId:"manager",role:"MANAGER",organizationId:"org",canEdit:true});m.rows.mockResolvedValue([]);m.update.mockResolvedValue({count:1});});
it("refreshes only this organization's old monthly and fortnightly schedules in bounded batches",async()=>{
 m.rows.mockResolvedValue([...["a","b","c","d"].map(id=>({id,updatedAt:new Date("2026-11-26T12:00Z"),recurrenceType:"MONTHLY",recurrenceData:{startDate:"2026-11-01",monthDays:[1]}})),{id:"daily",recurrenceType:"DAILY",recurrenceData:{interval:1}},{id:"done",recurrenceType:"MONTHLY",recurrenceData:{holidayBehavior:"NEXT_BUSINESS_DAY"}}]);
 const response=await POST(request());expect(await response.json()).toEqual({changed:3,next:"c"});expect(m.generate).toHaveBeenCalledTimes(3);
 expect(m.rows.mock.calls[0][0].where).toMatchObject({active:true,client:{organizationId:"org"}});
 expect(m.update.mock.calls[0][0]).toMatchObject({where:{id:"a",active:true,updatedAt:new Date("2026-11-26T12:00Z"),client:{organizationId:"org"}},data:{recurrenceData:{startDate:"2026-11-01",monthDays:[1],holidayBehavior:"NEXT_BUSINESS_DAY"}}});
});
it("resumes after a cursor and keeps failed generations unmarked for a safe retry",async()=>{
 m.rows.mockResolvedValue([{id:"r",updatedAt:new Date(),recurrenceType:"DAILY",recurrenceData:{interval:15}}]);m.generate.mockRejectedValue(new Error("temporary"));
 expect((await POST(request({after:"previous"}))).status).toBe(503);expect(m.update).not.toHaveBeenCalled();expect(m.rows.mock.calls[0][0].where.id).toEqual({gt:"previous"});
});
it("rejects operators, read-only managers and invalid cursors before any access",async()=>{
 for(const member of [null,{role:"OPERATOR"},{role:"MANAGER",canEdit:false}]){m.member.mockResolvedValueOnce(member);expect((await POST(request())).status).toBe(member?403:401);}
 expect((await POST(request({after:123}))).status).toBe(400);expect(m.rows).not.toHaveBeenCalled();
});
