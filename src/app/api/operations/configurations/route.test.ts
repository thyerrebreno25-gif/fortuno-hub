import {beforeEach,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/modules/operations/routine-client-state",()=>({routineClientSuspended:async()=>false}));
vi.mock("@/modules/operations/routine-ownership-server",()=>({inheritedOwner:async()=>null,propagateRoutineOwner:async()=>({transferred:0,pausedTimers:0})}));
const m=vi.hoisted(()=>({member:vi.fn(),client:vi.fn(),process:vi.fn(),previous:vi.fn(),create:vi.fn(),upsert:vi.fn(),generate:vi.fn(),person:vi.fn(),detach:vi.fn(),transaction:vi.fn(),lock:vi.fn()}));
vi.mock("@/modules/operations/auth",()=>({getOperationMember:m.member,canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/modules/operations/team-catalog",()=>({operationTeamCatalog:async()=>({options:["Elite do Fluxo","Força Tática Financeira"]})}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:m.transaction,client:{findFirst:m.client},operationProcess:{findFirst:m.process},operationClientProcess:{findMany:m.previous,create:m.create},organizationMember:{findFirst:m.person},operationActivity:{updateMany:m.detach}}}));
vi.mock("@/modules/operations/recurrence",()=>({generateActivitiesForConfigurationRange:m.generate}));
import {POST} from "./route";
it("rejects routine creation for a management profile without edit permission",async()=>{m.member.mockResolvedValue({role:"MANAGER",organizationId:"org",canEdit:false});expect((await POST(request())).status).toBe(403);expect(m.create).not.toHaveBeenCalled();});
it("requires valid monthly dates and persists multiple fixed dates",async()=>{
 for(const monthDays of [[],[0],[32],[1.5],null])expect((await POST(request({recurrenceType:"MONTHLY",recurrenceData:{monthDays}}))).status).toBe(400);
 expect(m.create).not.toHaveBeenCalled();
 expect((await POST(request({recurrenceType:"MONTHLY",recurrenceData:{startDate:"2027-01-05",monthDays:[5,20]}}))).status).toBe(201);
 expect(m.create.mock.calls[0][0].data.recurrenceData.monthDays).toEqual([5,20]);
});
const request=(patch:Record<string,unknown>={})=>new Request("https://hub.test/api/operations/configurations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientId:"client",processId:"process",createOnly:true,recurrenceType:"CUSTOM",recurrenceData:{startDate:"2027-01-05",weekdays:[1,3,5]},...patch})});
beforeEach(()=>{vi.resetAllMocks();m.member.mockResolvedValue({role:"MANAGER",userId:"user",organizationId:"org"});m.client.mockResolvedValue({id:"client"});m.process.mockResolvedValue({id:"process",defaultPriority:"MEDIUM"});m.previous.mockResolvedValue([]);m.transaction.mockImplementation(async fn=>fn({$executeRaw:m.lock,operationClientProcess:{findMany:m.previous,create:m.create}}));m.create.mockResolvedValue({id:"cfg"});m.generate.mockResolvedValue({created:39});});
it("creates a scoped routine, retains weekdays and generates exactly 90 calendar days from a future start",async()=>{const r=await POST(request());expect(r.status).toBe(201);expect(m.client.mock.calls[0][0].where).toEqual({id:"client",organizationId:"org"});expect(m.create.mock.calls[0][0].data.recurrenceData.weekdays).toEqual([1,3,5]);const args=m.generate.mock.calls[0];expect(args[1].toISOString().slice(0,10)).toBe("2027-01-05");expect((args[2].getTime()-args[1].getTime())/86400000).toBe(89);});
it("preserves an existing active routine and generates no new work for it",async()=>{m.previous.mockResolvedValue([{id:"existing",active:true,recurrenceType:"CUSTOM",recurrenceData:{startDate:"2027-01-05",weekdays:[5,1,3]}}]);const r=await POST(request());expect((await r.json()).skipped).toBe(true);expect(m.create).not.toHaveBeenCalled();expect(m.upsert).not.toHaveBeenCalled();expect(m.generate).not.toHaveBeenCalled();});
it("rejects missing or invalid custom weekdays before writes",async()=>{for(const weekdays of [[],[7],[1.5],null]){expect((await POST(request({recurrenceData:{weekdays}}))).status).toBe(400);}expect(m.create).not.toHaveBeenCalled();});
it("requires management permission and refuses a client outside the organization",async()=>{m.member.mockResolvedValueOnce({role:"OPERATOR"});expect((await POST(request())).status).toBe(403);m.client.mockResolvedValue(null);expect((await POST(request())).status).toBe(404);expect(m.create).not.toHaveBeenCalled();});
it("refuses a responsible person outside this organization",async()=>{m.person.mockResolvedValue(null);expect((await POST(request({responsibleId:"foreign"}))).status).toBe(400);expect(m.create).not.toHaveBeenCalled();});
it("does not overwrite a routine created concurrently",async()=>{m.create.mockRejectedValue({code:"P2002"});expect((await POST(request())).status).toBe(409);expect(m.upsert).not.toHaveBeenCalled();});

it("returns a resumable configuration when generation fails and resumes without overwriting settings",async()=>{m.generate.mockRejectedValueOnce(new Error("temporary"));const failed=await POST(request());expect(failed.status).toBe(503);expect((await failed.json()).configurationId).toBe("cfg");m.previous.mockResolvedValue([{id:"cfg",active:true,recurrenceType:"CUSTOM",recurrenceData:{startDate:"2027-01-05",weekdays:[1,3,5]}}]);m.create.mockClear();m.generate.mockResolvedValue({created:3});const resumed=await POST(request({resumeConfigurationId:"cfg"}));expect(resumed.status).toBe(201);expect(m.create).not.toHaveBeenCalled();expect(m.upsert).not.toHaveBeenCalled();});
it("refuses resuming a configuration from a different client or process",async()=>{m.previous.mockResolvedValue([{id:"other",active:true}]);expect((await POST(request({resumeConfigurationId:"cfg"}))).status).toBe(409);expect(m.generate).not.toHaveBeenCalled();});
it("saves the canonical selected team and refuses arbitrary free-text team names",async()=>{expect((await POST(request({team:"forca tatica financeira "}))).status).toBe(201);expect(m.create.mock.calls[0][0].data.team).toBe("Força Tática Financeira");m.create.mockClear();expect((await POST(request({team:"Outra equipe digitada"}))).status).toBe(400);expect(m.create).not.toHaveBeenCalled();});

it("creates Tuesday independently from an existing Monday routine without overwriting it",async()=>{m.previous.mockResolvedValue([{id:"monday",active:true,recurrenceType:"WEEKLY",recurrenceData:{startDate:"2027-01-05",weekdays:[1]}}]);const r=await POST(request({recurrenceType:"WEEKLY",recurrenceData:{startDate:"2027-01-05",weekdays:[2]}}));expect(r.status).toBe(201);expect(m.create).toHaveBeenCalledOnce();expect(m.create.mock.calls[0][0].data.recurrenceData.weekdays).toEqual([2]);expect(m.lock).toHaveBeenCalledTimes(2);expect(m.previous.mock.calls[0][0].where).toMatchObject({clientId:"client",processId:"process",active:true,client:{organizationId:"org"}});});
it("inherits the client's team, fixes payment agendas at high priority and always anticipates off-days",async()=>{m.client.mockResolvedValue({id:"client",notionSquad:"Elite Do Fluxo"});m.process.mockResolvedValue({id:"process",name:"Agenda de Pagamentos",defaultPriority:"LOW"});expect((await POST(request({priority:"LOW"}))).status).toBe(201);expect(m.create.mock.calls[0][0].data).toMatchObject({priority:"HIGH",team:"Elite do Fluxo",recurrenceData:{holidayBehavior:"PREVIOUS_BUSINESS_DAY"}});});
it("never enables completion emails for a reconciliation even if requested",async()=>{m.process.mockResolvedValue({id:"process",name:"Conciliação de Recebimentos",defaultPriority:"MEDIUM"});expect((await POST(request({notifyClient:true}))).status).toBe(201);expect(m.create.mock.calls[0][0].data.notifyClient).toBe(false);});
it("requires a real start date for monthly and legacy 15-day schedules before writing anything",async()=>{
 for(const recurrenceType of ["MONTHLY","DAILY"])for(const startDate of [undefined,"","2027-02-30","2027-13-01","amanhã"]){
  expect((await POST(request({recurrenceType,recurrenceData:{startDate,monthDays:[1,16],interval:15}}))).status).toBe(400);
 }
 expect(m.create).not.toHaveBeenCalled();expect(m.generate).not.toHaveBeenCalled();
});
it("retains a historical calendar anchor while generating only today forward",async()=>{
 const response=await POST(request({recurrenceType:"MONTHLY",recurrenceData:{startDate:"2026-01-01",monthDays:[1,16],interval:1}}));
 expect(response.status).toBe(201);expect(m.create.mock.calls[0][0].data.recurrenceData.startDate).toBe("2026-01-01");
 const {brazilDay}=await import("@/modules/operations/analytics");expect(m.generate.mock.calls[0][1].toISOString().slice(0,10)).toBe(brazilDay());
});
