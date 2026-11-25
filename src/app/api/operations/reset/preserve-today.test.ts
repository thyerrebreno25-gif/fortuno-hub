import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),count:vi.fn(),configsCount:vi.fn(),auditFind:vi.fn(),auditCreate:vi.fn(),lock:vi.fn(),query:vi.fn(),activities:vi.fn(),configs:vi.fn(),timers:vi.fn(),timerUpdate:vi.fn(),archive:vi.fn(),deactivate:vi.fn()}));
vi.mock("@/modules/operations/auth",()=>({getOperationMember:m.member,canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/lib/prisma",()=>{const tx={$executeRaw:m.lock,$queryRaw:m.query,operationActivity:{count:m.count,findMany:m.activities,updateMany:m.archive},operationClientProcess:{count:m.configsCount,findMany:m.configs,updateMany:m.deactivate},operationTimeEntry:{findMany:m.timers,update:m.timerUpdate},auditLog:{findFirst:m.auditFind,create:m.auditCreate}};return {prisma:{...tx,$transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)}};});
import {GET,POST} from "./route";
import {resetPreservation} from "@/modules/operations/reset-preservation";
const post=(data:unknown)=>POST(new Request("https://hub/api/operations/reset",{method:"POST",body:JSON.stringify(data)}));
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-25T15:00Z"));m.member.mockResolvedValue({userId:"master",organizationId:"org",role:"MASTER",canEdit:true});m.activities.mockResolvedValue([{id:"tomorrow",clientProcessId:"routine"}]);m.configs.mockResolvedValue([{id:"routine"}]);m.timers.mockResolvedValue([]);m.count.mockResolvedValue(5);m.configsCount.mockResolvedValue(1);m.auditFind.mockResolvedValue(null);m.archive.mockResolvedValue({count:1});});
it("previews today's preservation separately without changing records",async()=>{const response=await GET();expect(response.headers.get("cache-control")).toBe("private, no-store");expect(await response.json()).toMatchObject({preserveDay:"2026-11-25",protectedActivities:5,removableActivities:5});expect(m.archive).not.toHaveBeenCalled();});
it("locks activities, archives only outside today's protection and deactivates routines with an undo snapshot",async()=>{
 const response=await post({action:"archive",scope:"except_today",preserveDay:"2026-11-25"});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({activities:1,configurations:1,protectedActivities:5});
 expect(m.query.mock.calls[0][0].join(" ")).toContain('FOR UPDATE');expect(m.activities.mock.calls[0][0].where).toEqual(resetPreservation("org").removableWhere);expect(m.archive.mock.calls[0][0].where).toMatchObject({organizationId:"org",deletedAt:null,id:{in:["tomorrow"]}});expect(m.timerUpdate).not.toHaveBeenCalled();
 expect(m.deactivate.mock.calls[0][0]).toMatchObject({where:{client:{organizationId:"org"}},data:{active:false}});expect(m.auditCreate.mock.calls[0][0].data).toMatchObject({action:"OPERATIONS_RESET",beforeData:{activities:[{id:"tomorrow",clientProcessId:"routine"}],configurations:["routine"]},afterData:{scope:"except_today",preserveDay:"2026-11-25"}});
});
it("rejects a stale day, unauthorized profiles and read-only managers before mutation",async()=>{
 expect((await post({action:"archive",scope:"except_today",preserveDay:"2026-11-24"})).status).toBe(409);expect(m.archive).not.toHaveBeenCalled();
 for(const member of [{role:"OPERATOR",canEdit:true},{role:"MANAGER",canEdit:false}]){m.member.mockResolvedValueOnce({...member,userId:"u",organizationId:"org"});expect((await post({action:"archive",scope:"all"})).status).toBe(403);}
 expect(m.deactivate).not.toHaveBeenCalled();
});
it("keeps the existing restore path available and limits oversized cleanups before writes",async()=>{
 m.activities.mockResolvedValue(Array.from({length:20001},(_,id)=>({id:String(id),clientProcessId:null})));expect((await post({action:"archive",scope:"except_today",preserveDay:"2026-11-25"})).status).toBe(409);expect(m.archive).not.toHaveBeenCalled();
 m.activities.mockResolvedValue([]);m.auditFind.mockResolvedValueOnce({id:"undo",beforeData:{configurations:[],activities:[{id:"old",clientProcessId:null}]}}).mockResolvedValueOnce(null);m.configs.mockResolvedValue([]);expect((await post({action:"restore",restoreId:"undo"})).status).toBe(200);expect(m.archive.mock.calls.at(-1)![0].data).toMatchObject({deletedAt:null,deletionReason:null});
});
it("cleans future tasks with past/current work excluded and retains the full undo snapshot",async()=>{
 const rows=Array.from({length:10857},(_,id)=>({id:String(id),clientProcessId:"routine"}));m.activities.mockResolvedValue(rows);
 const response=await post({action:"archive",scope:"future_only",preserveDay:"2026-11-25"});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({activities:10857});
 expect(m.activities.mock.calls[0][0].where).toEqual(resetPreservation("org").futureWhere);expect(m.archive).toHaveBeenCalledTimes(22);expect(m.archive.mock.calls.flatMap(([arg])=>arg.where.id.in)).toEqual(rows.map(r=>r.id));expect(m.auditCreate.mock.calls[0][0].data.beforeData.activities).toHaveLength(10857);
});
it("restores large snapshots in batches, retaining each original routine and checking every row",async()=>{
 const rows=Array.from({length:10857},(_,id)=>({id:String(id),clientProcessId:id<10000?"routine":null}));
 m.auditFind.mockResolvedValueOnce({id:"undo",beforeData:{configurations:[],activities:rows}}).mockResolvedValueOnce(null);m.configs.mockResolvedValue([]);m.archive.mockImplementation(async(arg)=>({count:arg.where.id.in.length}));
 expect((await post({action:"restore",restoreId:"undo"})).status).toBe(200);expect(m.archive).toHaveBeenCalledTimes(22);expect(m.archive.mock.calls.flatMap(([arg])=>arg.where.id.in)).toEqual(rows.map(r=>r.id));expect(m.archive.mock.calls.at(-1)![0].data.clientProcessId).toBeNull();
 m.auditFind.mockResolvedValueOnce({id:"undo",beforeData:{configurations:[],activities:rows}}).mockResolvedValueOnce(null);m.archive.mockResolvedValueOnce({count:499});expect((await post({action:"restore",restoreId:"undo"})).status).toBe(409);
});
