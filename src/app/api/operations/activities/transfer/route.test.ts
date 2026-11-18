import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),preview:vi.fn(),transfer:vi.fn()}));
vi.mock("@/lib/prisma",()=>({prisma:{}}));
vi.mock("@/modules/operations/auth",()=>({getOperationMember:m.member,canManageOperations:(role:string)=>["MASTER","ADMIN","MANAGER"].includes(role)}));
vi.mock("@/modules/operations/transfer-server",async original=>({...await original<typeof import("@/modules/operations/transfer-server")>(),previewActivityTransfer:m.preview,transferActivities:m.transfer}));
import {POST} from "./route";
const member={organizationId:"org",userId:"operator",role:"OPERATOR",canEdit:true};
const preview={action:"preview",activityIds:["a"]};
const post=(body:unknown)=>POST(new Request("https://hub.test/api/operations/activities/transfer",{method:"POST",body:JSON.stringify(body)}));
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue(member);m.preview.mockResolvedValue({activities:[],operators:[]});m.transfer.mockResolvedValue({transferredIds:["a"],unchanged:0,pausedTimers:1});});
it("checks session and edit access before exposing a preview or transferring",async()=>{
 m.member.mockResolvedValueOnce(null);expect((await post(preview)).status).toBe(401);m.member.mockResolvedValueOnce({...member,canEdit:false});expect((await post(preview)).status).toBe(403);m.member.mockResolvedValueOnce({...member,role:"CLIENT"});expect((await post(preview)).status).toBe(403);expect(m.preview).not.toHaveBeenCalled();expect(m.transfer).not.toHaveBeenCalled();
});
it("previews only the explicit selection using the authenticated member and never mutates",async()=>{
 const response=await post(preview);expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(m.preview).toHaveBeenCalledWith(member,["a"]);expect(m.transfer).not.toHaveBeenCalled();
});
it("requires a valid unique reviewed snapshot and forwards confirmation to the atomic service",async()=>{
 expect((await post({action:"preview",activityIds:["a","a"]})).status).toBe(400);expect((await post({action:"confirm",activities:[]})).status).toBe(400);
 const body={action:"confirm",responsibleId:"next",reason:"",activities:[{id:"a",updatedAt:"2026-11-18T15:00:00.000Z"}]};expect(await (await post(body)).json()).toEqual({transferredIds:["a"],unchanged:0,pausedTimers:1});expect(m.transfer).toHaveBeenCalledWith(member,body);
});
it("does not expose internal database errors",async()=>{m.preview.mockRejectedValue(new Error("private database detail"));const response=await post(preview);expect(response.status).toBe(500);expect(JSON.stringify(await response.json())).not.toContain("private");});
