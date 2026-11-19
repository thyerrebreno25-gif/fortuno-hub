import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({transaction:vi.fn(),lock:vi.fn(),query:vi.fn(),find:vi.fn(),preview:vi.fn(),target:vi.fn(),currentTarget:vi.fn(),members:vi.fn(),permissions:vi.fn(),timers:vi.fn(),stop:vi.fn(),update:vi.fn(),events:vi.fn()}));
vi.mock("@/modules/operations/auth",()=>({canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));
vi.mock("@/lib/prisma",()=>({prisma:{operationActivity:{findMany:m.preview},organizationMember:{findFirst:m.target,findMany:m.members},$transaction:m.transaction}}));
import {previewActivityTransfer,transferActivities} from "./transfer-server";
import {transferActivityInput,type ActivityTransfer} from "./transfer-model";
import type {getOperationMember} from "./auth";
type Member=NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;
const now=new Date("2026-11-18T15:00:00Z"),updatedAt="2026-11-18T12:00:00.000Z";
const member={userId:"manager",organizationId:"org",role:"MANAGER",canEdit:true,user:{name:"Gestora",email:"m@test"}} as Member;
const target={role:"OPERATOR",user:{id:"next",name:"Novo operador",email:"next@test"}};
const input:ActivityTransfer={action:"confirm",responsibleId:"next",reason:"Reorganização da equipe",activities:[{id:"a",updatedAt},{id:"b",updatedAt}]};
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(now);
 m.target.mockResolvedValue(target);m.members.mockResolvedValue([target]);m.permissions.mockResolvedValue({OPERATIONS:{canView:true,canEdit:true}});m.currentTarget.mockResolvedValue({userId:"next"});
 m.find.mockResolvedValue(input.activities.map(item=>({...item,updatedAt:new Date(updatedAt),responsibleId:"old",responsible:{name:"Anterior",email:"old@test"}})));m.preview.mockResolvedValue(input.activities);m.timers.mockResolvedValue([]);m.stop.mockResolvedValue({count:1});m.update.mockResolvedValue({count:2});
 m.transaction.mockImplementation(fn=>fn({$executeRaw:m.lock,$queryRaw:m.query,organizationMember:{findFirst:m.currentTarget},operationActivity:{findMany:m.find,updateMany:m.update},operationTimeEntry:{findMany:m.timers,updateMany:m.stop},operationEvent:{createMany:m.events}}));
});
afterEach(()=>vi.useRealTimers());
it("atomically changes only the reviewed owners, preserving task identity, routine, dates, checklist and accumulated time",async()=>{
 expect(await transferActivities(member,input)).toEqual({transferredIds:["a","b"],unchanged:0,pausedTimers:0});
 expect(m.update.mock.calls[0][0]).toEqual({where:{id:{in:["a","b"]},organizationId:"org",deletedAt:null,status:{in:["OPEN","IN_PROGRESS","PAUSED","BLOCKED"]}},data:{responsibleId:"next"}});
 expect(m.events.mock.calls[0][0].data).toContainEqual(expect.objectContaining({activityId:"a",userId:"manager",type:"ASSIGNED",metadata:{fromResponsibleId:"old",toResponsibleId:"next",reason:input.reason,batch:true}}));expect(m.lock.mock.calls[0][1]).toBe("operations-reset-org");expect(m.query.mock.calls[1][0].sql).toContain("ORDER BY id FOR UPDATE");
});
it("pauses running timers at the actual elapsed duration without changing their authors",async()=>{
 m.timers.mockResolvedValue([{id:"timer",startedAt:new Date(+now-125000)}]);expect((await transferActivities(member,input)).pausedTimers).toBe(1);expect(m.stop.mock.calls[0][0]).toEqual({where:{id:"timer",endedAt:null},data:{endedAt:now,seconds:125}});
});
it("restricts operators to their own selected tasks in preview and confirmation",async()=>{
 const operator={...member,role:"OPERATOR" as const,userId:"old"};await previewActivityTransfer(operator,["a","b"]);await transferActivities(operator,input);
 for(const query of [m.preview.mock.calls[0][0],m.find.mock.calls[0][0],m.update.mock.calls[0][0]])expect(query.where).toMatchObject({organizationId:"org",responsibleId:"old",deletedAt:null,status:{in:["OPEN","IN_PROGRESS","PAUSED","BLOCKED"]}});
});
it("rejects missing, completed, foreign or no-longer-owned activities before pausing timers or making partial transfers",async()=>{
 m.find.mockResolvedValue([{id:"a",updatedAt:new Date(updatedAt)}]);await expect(transferActivities(member,input)).rejects.toMatchObject({status:409});expect(m.timers).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();expect(m.events).not.toHaveBeenCalled();
 m.preview.mockResolvedValue([]);await expect(previewActivityTransfer(member,["foreign"])).rejects.toMatchObject({status:409});
});
it("rejects stale reviewed versions instead of transferring a concurrently modified selection",async()=>{
 m.find.mockResolvedValue([{id:"a",updatedAt:now},{id:"b",updatedAt:new Date(updatedAt)}]);await expect(transferActivities(member,input)).rejects.toMatchObject({status:409});expect(m.update).not.toHaveBeenCalled();expect(m.stop).not.toHaveBeenCalled();
});
it("does not stop timers or write duplicate history for tasks already owned by the destination",async()=>{
 m.find.mockResolvedValue(input.activities.map(item=>({...item,updatedAt:new Date(updatedAt),responsibleId:"next"})));expect(await transferActivities(member,input)).toEqual({transferredIds:[],unchanged:2,pausedTimers:0});expect(m.timers).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();expect(m.events).not.toHaveBeenCalled();
});
it("only pauses and transfers changed rows when the selection includes tasks already assigned to the destination",async()=>{
 m.find.mockResolvedValue([{id:"a",updatedAt:new Date(updatedAt),responsibleId:"old"},{id:"b",updatedAt:new Date(updatedAt),responsibleId:"next"}]);m.update.mockResolvedValue({count:1});expect(await transferActivities(member,input)).toEqual({transferredIds:["a"],unchanged:1,pausedTimers:0});expect(m.timers.mock.calls[0][0].where.activityId.in).toEqual(["a"]);expect(m.events.mock.calls[0][0].data).toHaveLength(1);
});
it("validates the destination's organization, membership and edit access before changing activities",async()=>{
 m.target.mockResolvedValueOnce(null);await expect(transferActivities(member,input)).rejects.toMatchObject({status:400});m.permissions.mockResolvedValueOnce({OPERATIONS:{canView:true,canEdit:false}});await expect(transferActivities(member,input)).rejects.toMatchObject({status:400});expect(m.transaction).not.toHaveBeenCalled();
 m.currentTarget.mockResolvedValueOnce(null);await expect(transferActivities(member,input)).rejects.toMatchObject({status:409});expect(m.find).not.toHaveBeenCalled();expect(m.target.mock.calls[0][0].where).toMatchObject({organizationId:"org",userId:"next",role:{not:"CLIENT"}});
});
it("rejects read-only profiles and client roles without querying activities",async()=>{
 for(const caller of [{...member,canEdit:false},{...member,role:"CLIENT" as const}]){await expect(previewActivityTransfer(caller,["a"])).rejects.toMatchObject({status:403});await expect(transferActivities(caller,input)).rejects.toMatchObject({status:403});}expect(m.transaction).not.toHaveBeenCalled();expect(m.preview).not.toHaveBeenCalled();
});
it("excludes colleagues without operations edit access from the destination options",async()=>{
 m.members.mockResolvedValue([target,{role:"MANAGER",user:{id:"read-only"}}]);m.permissions.mockImplementation(async(_org,role)=>({OPERATIONS:{canView:true,canEdit:role!=="MANAGER"}}));expect((await previewActivityTransfer(member,["a","b"])).operators).toEqual([target.user]);
});
it("requires unique explicit IDs and reviewed versions, limiting batch size and comments",()=>{
 for(const body of [{action:"preview",activityIds:[]},{action:"preview",activityIds:["a","a"]},{...input,activities:[input.activities[0],input.activities[0]]},{...input,activities:[{id:"a",updatedAt:"invalid"}]},{...input,reason:"a".repeat(1001)}])expect(transferActivityInput.safeParse(body).success).toBe(false);
 expect(transferActivityInput.safeParse(input).success).toBe(true);
});
