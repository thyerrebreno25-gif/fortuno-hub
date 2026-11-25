import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({requestDisregard:vi.fn(),member:vi.fn(),find:vi.fn(),unique:vi.fn(),update:vi.fn(),entries:vi.fn(),stop:vi.fn(),event:vi.fn(),mail:vi.fn(),lock:vi.fn(),row:vi.fn(),checklist:vi.fn()}));
vi.mock("@/modules/operations/auth",()=>({getOperationMember:m.member,canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/modules/operations/activity",()=>({activityInclude:{},createEvent:m.event}));
vi.mock("@/modules/operations/email",()=>({sendOperationCompletionEmail:m.mail}));
vi.mock("@/lib/prisma",()=>{const tx={operationActivity:{findFirst:m.find,findUnique:m.unique,update:m.update},operationChecklistItem:{update:m.checklist},operationTimeEntry:{findMany:m.entries,updateMany:m.stop},operationEvent:{create:m.event},$executeRaw:m.lock,$queryRaw:m.row};return {prisma:{...tx,$transaction:(run:(tx:unknown)=>unknown)=>run(tx)}};});
vi.mock("@/modules/operations/disregard-server",()=>({requestDisregard:m.requestDisregard}));
import {PATCH,DELETE} from "./route";
const fixture=()=>({id:"task",organizationId:"org",responsibleId:"operator",status:"IN_PROGRESS",title:"Agenda de Pagamentos",completedAt:null,completionNote:null,checklistItems:[{id:"item",title:"Conferência",mandatory:true,completed:true,requiresAttachment:false,requiresComment:false,allowDisregard:true,disregardedAt:null}],attachments:[] as Array<{id:string;name:string;checklistItemId:string}>,process:{name:"Agenda de Pagamentos",requiresAttachment:false,notifyClient:true},clientProcess:null,client:{name:"Cliente",operationalEmail:"client@test",operationalEmailCc:null},responsible:{name:"Isabella"},timeEntries:[{id:"entry",startedAt:new Date(Date.now()-120000),endedAt:null,seconds:0}]});
let current:ReturnType<typeof fixture>;
const complete=()=>PATCH(new Request("https://hub.test/api/operations/activities/task",{method:"PATCH",body:JSON.stringify({action:"complete"})}),{params:Promise.resolve({id:"task"})});
afterEach(()=>vi.useRealTimers());
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));vi.clearAllMocks();current=fixture();m.member.mockResolvedValue({organizationId:"org",userId:"operator",role:"OPERATOR",canEdit:true,user:{name:"Isabella",email:"i@test"}});m.find.mockImplementation(async()=>current);m.unique.mockImplementation(async()=>current);m.update.mockImplementation(async({data})=>Object.assign(current,data));m.entries.mockImplementation(async()=>current.timeEntries.filter(entry=>!entry.endedAt));m.stop.mockImplementation(async({where,data})=>{Object.assign(current.timeEntries.find(entry=>entry.id===where.id)!,data);return {count:1};});m.mail.mockResolvedValue({sent:true});});
it("does not finalize or stop time when a mandatory checklist item remains open",async()=>{current.checklistItems[0].completed=false;const response=await complete();expect(response.status).toBe(400);expect(await response.text()).toContain("Conferência");expect(m.stop).not.toHaveBeenCalled();expect(m.mail).not.toHaveBeenCalled();});
it("requires both process and checklist attachments without bypassing them from the global timer",async()=>{current.process.requiresAttachment=true;expect((await complete()).status).toBe(400);current.process.requiresAttachment=false;current.checklistItems[0].requiresAttachment=true;expect((await complete()).status).toBe(400);expect(m.update).not.toHaveBeenCalled();expect(m.mail).not.toHaveBeenCalled();});
it("atomically stops active entries and finalizes once, without duplicating client notifications",async()=>{const response=await complete();expect(response.status).toBe(200);expect(current.status).toBe("COMPLETED");expect(m.lock.mock.calls[0][1]).toBe("operation-timer:operator");expect(m.row.mock.calls[0].slice(1)).toEqual(["task","org"]);expect(m.stop.mock.calls[0][0]).toMatchObject({where:{id:"entry",endedAt:null},data:{seconds:120}});expect(m.mail).toHaveBeenCalledOnce();expect((await complete()).status).toBe(200);expect(m.mail).toHaveBeenCalledOnce();expect(m.stop).toHaveBeenCalledOnce();});
it("does not complete another operator's work or accept a profile without editing permission",async()=>{current.responsibleId="another";expect((await complete()).status).toBe(403);m.member.mockResolvedValueOnce({canEdit:false});expect((await complete()).status).toBe(403);expect(m.stop).not.toHaveBeenCalled();expect(m.mail).not.toHaveBeenCalled();});

it("saves checklist checks from the top bar without finalizing before explicit confirmation",async()=>{
 current.checklistItems[0].completed=false;
 m.checklist.mockImplementation(async({data})=>Object.assign(current.checklistItems[0],data));
 const response=await PATCH(new Request("https://hub.test/api/operations/activities/task",{method:"PATCH",body:JSON.stringify({action:"checklist",itemId:"item",completed:true,autoComplete:false})}),{params:Promise.resolve({id:"task"})});
 expect(response.status).toBe(200);expect(current.checklistItems[0].completed).toBe(true);expect(current.status).toBe("IN_PROGRESS");expect(m.stop).not.toHaveBeenCalled();expect(m.mail).not.toHaveBeenCalled();
 expect((await complete()).status).toBe(200);expect(m.mail).toHaveBeenCalledOnce();
});
it("keeps document disregard optional while task disregard goes through manager approval",async()=>{
 const patch=(body:Record<string,unknown>)=>PATCH(new Request("https://hub.test/api/operations/activities/task",{method:"PATCH",body:JSON.stringify(body)}),{params:Promise.resolve({id:"task"})});
 expect((await patch({action:"disregardChecklist",itemId:"item"})).status).toBe(200);
 expect(m.checklist).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({disregardReason:null,disregardedById:"operator"})}));
 expect((await patch({action:"status",status:"DISREGARDED",reason:"Não se aplica nesta competência"})).status).toBe(200);expect(m.requestDisregard).toHaveBeenCalledWith(expect.objectContaining({userId:"operator"}),"task","Não se aplica nesta competência");expect(current.status).toBe("IN_PROGRESS");
 expect((await patch({action:"status",status:"BLOCKED"})).status).toBe(400);
});
it("does not let a read-only manager delete a task",async()=>{
 m.member.mockResolvedValue({organizationId:"org",userId:"manager",role:"MANAGER",canEdit:false,user:{name:"Gestora"}});
 const response=await DELETE(new Request("https://hub.test/api/operations/activities/task",{method:"DELETE",body:JSON.stringify({reason:"Atividade duplicada"})}),{params:Promise.resolve({id:"task"})});
 expect(response.status).toBe(403);expect(m.update).not.toHaveBeenCalled();
});

it("never sends completion emails for reconciliations even when an old routine enabled them",async()=>{current.process.name="Conciliação de Recebimentos";current.title="Atividade renomeada";expect((await complete()).status).toBe(200);expect(current.status).toBe("COMPLETED");expect(m.mail).not.toHaveBeenCalled();});
