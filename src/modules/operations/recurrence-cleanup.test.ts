import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({configuration:vi.fn(),live:vi.fn(),existing:vi.fn(),old:vi.fn(),update:vi.fn(),create:vi.fn(),lock:vi.fn(),owner:vi.fn(),suspended:vi.fn(),event:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{operationClientProcess:{findUnique:m.configuration},operationActivity:{findUnique:m.existing},$transaction:async(fn:(tx:unknown)=>unknown)=>fn({$executeRaw:m.lock,$queryRaw:m.lock,operationClientProcess:{findFirst:m.live},operationActivity:{create:m.create,findUnique:m.old,update:m.update}})}}));
vi.mock("./activity",()=>({activityInclude:{},createEvent:m.event}));
vi.mock("./routine-ownership-server",()=>({inheritedOwner:m.owner}));
vi.mock("./routine-client-state",()=>({routineClientSuspended:m.suspended}));
import {generateActivityForConfiguration} from "./recurrence";
beforeEach(()=>{vi.resetAllMocks();m.old.mockResolvedValue(null);m.owner.mockResolvedValue(null);m.suspended.mockResolvedValue(false);m.configuration.mockResolvedValue({id:"routine",active:true,recurrenceType:"DAILY",recurrenceData:{},clientId:"client",processId:"process",responsibleId:"operator",client:{organizationId:"org",cluster:"A"},process:{name:"Tarefa",checklistTemplates:[]}});m.existing.mockResolvedValue(null);m.create.mockResolvedValue({id:"new"});});
it("does not create tomorrow's task from a configuration loaded before cleanup deactivated it",async()=>{m.live.mockResolvedValue(null);expect(await generateActivityForConfiguration("routine",new Date("2026-11-26T12:00Z"),"master",new Set())).toBeNull();expect(m.lock.mock.calls[0][1]).toBe("operations-reset-org");expect(m.create).not.toHaveBeenCalled();expect(m.event).not.toHaveBeenCalled();});
it("continues normal generation for a configuration still active under the same organization lock",async()=>{m.live.mockResolvedValue({id:"routine"});expect(await generateActivityForConfiguration("routine",new Date("2026-11-26T12:00Z"),"master",new Set())).toEqual({id:"new"});expect(m.live.mock.calls[0][0].where).toEqual({id:"routine",active:true,client:{organizationId:"org"}});expect(m.event).toHaveBeenCalledOnce();});
it("does not create an unchecked weekday from a generator that kept an old range",async()=>{m.configuration.mockResolvedValue({id:"routine",active:true,recurrenceType:"WEEKLY",recurrenceData:{weekdays:[2]},client:{organizationId:"org"}});expect(await generateActivityForConfiguration("routine",new Date("2026-11-30T12:00Z"),"master",new Set())).toBeNull();expect(m.create).not.toHaveBeenCalled();});
it("does not create from a schedule changed between load and the organization lock",async()=>{const configuration=await m.configuration();m.configuration.mockResolvedValue({...configuration,updatedAt:new Date("2026-11-25T12:00Z")});m.live.mockResolvedValue({id:"routine",updatedAt:new Date("2026-11-25T13:00Z")});expect(await generateActivityForConfiguration("routine",new Date("2026-11-26T12:00Z"),"master",new Set())).toBeNull();expect(m.create).not.toHaveBeenCalled();});
it("generates only on the previous business day, with the client's current team and high agenda priority",async()=>{const configuration=await m.configuration();m.configuration.mockResolvedValue({...configuration,recurrenceData:{holidayBehavior:"KEEP"},team:"Força Tática Financeira",priority:"LOW",client:{...configuration.client,notionSquad:"Elite Do Fluxo"},process:{...configuration.process,name:"Agenda de Pagamentos"}});m.live.mockResolvedValue({id:"routine"});await generateActivityForConfiguration("routine",new Date("2026-11-30T12:00Z"),"master",new Set(["2026-11-30","2026-11-27"]));expect(m.create.mock.calls[0][0].data).toMatchObject({scheduledDate:new Date("2026-11-26T00:00Z"),team:"Elite do Fluxo",priority:"HIGH"});});

it("does not generate weekend tasks for daily, weekly or one-off schedules",async()=>{for(const [recurrenceType,recurrenceData] of [["ONCE",{startDate:"2026-11-28"}],["DAILY",{dailyMode:"ALL_DAYS"}],["WEEKLY",{weekdays:[6,0]}],["CUSTOM",{weekdays:[6,0]}]] as const){for(const day of [28,29]){const configuration=await m.configuration();m.configuration.mockResolvedValue({...configuration,recurrenceType,recurrenceData});expect(await generateActivityForConfiguration("routine",new Date(`2026-11-${day}T12:00Z`),"master",new Set([`2026-11-${day}`]))).toBeNull();}}expect(m.existing).not.toHaveBeenCalled();expect(m.create).not.toHaveBeenCalled();expect(m.event).not.toHaveBeenCalled();});
it("generates monthly and 15-day weekend occurrences after the weekend and Monday holiday",async()=>{
 m.live.mockResolvedValue({id:"routine"});
 for(const [recurrenceType,recurrenceData] of [["MONTHLY",{startDate:"2026-11-28",monthDays:[28]}],["DAILY",{startDate:"2026-11-13",interval:15}]] as const){
  const configuration=await m.configuration();m.configuration.mockResolvedValue({...configuration,recurrenceType,recurrenceData});
  await generateActivityForConfiguration("routine",new Date("2026-11-28T12:00Z"),"master",new Set(["2026-11-30"]));
  expect(m.create.mock.lastCall![0].data).toMatchObject({scheduledDate:new Date("2026-12-01T00:00Z"),dueAt:new Date("2026-12-01T21:00Z"),competence:"2026-12"});
 }
});
it("moves an untouched anticipated task by updating the same ID rather than duplicating it",async()=>{
 const configuration=await m.configuration();m.configuration.mockResolvedValue({...configuration,recurrenceType:"MONTHLY",recurrenceData:{startDate:"2026-11-01",monthDays:[30]}});m.live.mockResolvedValue({id:"routine"});
 m.old.mockResolvedValue({id:"old",status:"OPEN",deletedAt:null,timeEntries:[],comments:[],attachments:[],checklistItems:[]});m.update.mockResolvedValue({id:"old"});
 expect(await generateActivityForConfiguration("routine",new Date("2026-11-30T12:00Z"),"master",new Set(["2026-11-30"]))).toEqual({id:"old"});
 expect(m.update.mock.calls[0][0]).toMatchObject({where:{id:"old"},data:{scheduledDate:new Date("2026-12-01T00:00Z")}});expect(m.create).not.toHaveBeenCalled();expect(m.event.mock.calls[0][2]).toBe("STATUS_CHANGED");
});
it("preserves worked or deleted anticipated occurrences and does not recreate them on the postponed date",async()=>{
 const configuration=await m.configuration();m.configuration.mockResolvedValue({...configuration,recurrenceType:"MONTHLY",recurrenceData:{startDate:"2026-11-01",monthDays:[30]}});m.live.mockResolvedValue({id:"routine"});
 for(const patch of [{status:"COMPLETED"},{status:"PAUSED"},{timeEntries:[{id:"time"}]},{attachments:[{id:"file"}]},{deletedAt:new Date()}]){
  m.old.mockResolvedValue({id:"old",status:"OPEN",deletedAt:null,timeEntries:[],comments:[],attachments:[],checklistItems:[],...patch});
  await generateActivityForConfiguration("routine",new Date("2026-11-30T12:00Z"),"master",new Set(["2026-11-30"]));
 }
 expect(m.create).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();expect(m.event).not.toHaveBeenCalled();
});

it("blocks generation for a suspended client and inherits the live primary owner",async()=>{m.live.mockResolvedValue({id:"routine"});m.suspended.mockResolvedValueOnce(true);expect(await generateActivityForConfiguration("routine",new Date("2026-11-26T12:00Z"),"master",new Set())).toBeNull();expect(m.create).not.toHaveBeenCalled();m.owner.mockResolvedValue("reconciliation-owner");await generateActivityForConfiguration("routine",new Date("2026-11-26T12:00Z"),"master",new Set());expect(m.create.mock.calls[0][0].data.responsibleId).toBe("reconciliation-owner");});
