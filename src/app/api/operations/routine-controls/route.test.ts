import {beforeEach,afterEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),client:vi.fn(),routine:vi.fn(),routines:vi.fn(),activities:vi.fn(),update:vi.fn(),configUpdate:vi.fn(),raw:vi.fn(),execute:vi.fn(),audit:vi.fn(),timers:vi.fn(),stop:vi.fn(),events:vi.fn(),generate:vi.fn()}));
vi.mock("@/modules/operations/auth",()=>({getOperationMember:m.member,canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/modules/operations/recurrence",()=>({generateActivitiesForConfigurationRange:m.generate,matchesRecurrence:()=>true}));
vi.mock("@/lib/prisma",()=>{const tx={client:{findFirst:m.client},organizationMember:{findFirst:async()=>({id:"member"})},operationClientProcess:{findFirst:m.routine,findMany:m.routines,update:m.configUpdate},operationActivity:{findMany:m.activities,updateMany:m.update},operationTimeEntry:{findMany:m.timers,updateMany:m.stop},operationEvent:{createMany:m.events},auditLog:{create:m.audit},$queryRaw:m.raw,$executeRaw:m.execute};return {prisma:{...tx,$transaction:(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
import {POST} from "./route";
const request=(body:object)=>new Request("https://hub.test/api/operations/routine-controls",{method:"POST",body:JSON.stringify(body)});
const config=(id:string,name:string)=>({id,clientId:"client",responsibleId:"old",process:{name},updatedAt:new Date("2026-11-26T12:00Z")});
const task=(id:string)=>({id,status:"OPEN",disregardReview:null,timeEntries:[],comments:[],attachments:[],checklistItems:[]});
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T15:00Z"));m.member.mockResolvedValue({userId:"manager",organizationId:"org",role:"MANAGER",canEdit:true});m.client.mockResolvedValue({id:"client"});m.raw.mockResolvedValue([]);m.execute.mockResolvedValue(1);m.activities.mockResolvedValue([]);m.routines.mockResolvedValue([]);m.timers.mockResolvedValue([]);m.update.mockImplementation(async args=>({count:args.where.id?.in.length||0}));m.stop.mockResolvedValue({count:1});});
afterEach(()=>vi.useRealTimers());
it("suspends only untouched future routine tasks, preserving work and the current day",async()=>{
 m.activities.mockResolvedValue([task("future"),{...task("worked"),timeEntries:[{id:"t"}]},{...task("attachment"),attachments:[{id:"a"}]},{...task("done"),status:"COMPLETED"},{...task("checked"),checklistItems:[{completed:true}]},{...task("approval"),disregardReview:{state:"PENDING"}}]);
 const response=await POST(request({action:"suspend",clientId:"client"}));expect(response.status).toBe(200);expect(await response.json()).toEqual({changed:1});
 expect(m.activities.mock.calls[0][0].where).toMatchObject({organizationId:"org",clientId:"client",scheduledDate:{gte:new Date("2026-11-27T00:00Z")},deletedAt:null,clientProcess:{active:true}});
 expect(m.update.mock.calls[0][0]).toMatchObject({where:{id:{in:["future"]}},data:{deletionReason:"Cliente com rotinas suspensas"}});expect(m.generate).not.toHaveBeenCalled();
});
it("reactivates only suspension removals and resumes the active schedules",async()=>{
 m.routines.mockResolvedValue([{id:"routine"}]);m.activities.mockResolvedValue([task("future")]);
 expect((await POST(request({action:"resume",clientId:"client"}))).status).toBe(200);
 expect(m.activities.mock.calls[0][0].where).toMatchObject({deletionReason:"Cliente com rotinas suspensas",deletedAt:{not:null}});
 expect(m.update.mock.calls[0][0].data).toEqual({deletedAt:null,deletedById:null,deletionReason:null});expect(m.generate).toHaveBeenCalledWith("routine",new Date("2026-11-27T12:00Z"),expect.any(Date),"manager");
});
it("transfers the primary reconciliation, calendars and card routines while leaving receipt ownership intact",async()=>{
 const routines=[config("payment","Conciliação de Pagamentos"),config("agenda","Agenda de Pagamentos"),config("card","Conciliar Faturas de Cartão de Crédito"),config("receipt","Conciliação de Recebimentos")];m.routine.mockResolvedValue(routines[1]);m.routines.mockResolvedValue(routines);m.activities.mockResolvedValue([{id:"task",responsibleId:"old"}]);
 const response=await POST(request({action:"transfer",clientId:"client",routineId:"agenda",expectedUpdatedAt:routines[1].updatedAt.toISOString(),responsibleId:"new"}));expect(response.status).toBe(200);
 expect(m.configUpdate.mock.calls.map(c=>c[0].where.id)).toEqual(["payment","agenda","card"]);
 expect(m.update.mock.calls.filter(c=>c[0].data.responsibleId==="new")).toHaveLength(3);
});
it("checks organization, edit permission and concurrent routine changes",async()=>{
 m.member.mockResolvedValueOnce({role:"OPERATOR",organizationId:"org",canEdit:true});expect((await POST(request({action:"suspend",clientId:"client"}))).status).toBe(403);expect(m.client).not.toHaveBeenCalled();
 m.client.mockResolvedValueOnce(null);expect((await POST(request({action:"suspend",clientId:"foreign"}))).status).toBe(404);
 m.routine.mockResolvedValue(config("routine","Agenda de Pagamentos"));expect((await POST(request({action:"transfer",clientId:"client",routineId:"routine",responsibleId:"new",expectedUpdatedAt:"old"}))).status).toBe(409);expect(m.configUpdate).not.toHaveBeenCalled();
});
