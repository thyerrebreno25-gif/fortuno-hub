import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),reroute:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getServiceCenterPermission:m.permission,SERVICE_CENTER_MANAGER_ROLES:new Set(["MASTER","ADMIN","MANAGER"])}));
vi.mock("@/modules/atendimento/routing/reprocess",()=>({rerouteGmailTickets:m.reroute}));
import {POST} from "./route";
beforeEach(()=>{vi.resetAllMocks();m.member.mockResolvedValue({organizationId:"org",role:"MASTER"});m.permission.mockResolvedValue({canView:true,canEdit:true});m.reroute.mockResolvedValue({checked:2,changed:1});});
it("requires a manager with editing permission before reclassifying",async()=>{
 m.member.mockResolvedValueOnce(null);expect((await POST()).status).toBe(401);
 m.member.mockResolvedValueOnce({organizationId:"org",role:"OPERATOR"});expect((await POST()).status).toBe(403);
 m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await POST()).status).toBe(403);expect(m.reroute).not.toHaveBeenCalled();
});
it.each(["MASTER","ADMIN","MANAGER"])("allows %s to reclassify only their own organization",async role=>{
 m.member.mockResolvedValue({organizationId:"org",role});const response=await POST();expect(response.status).toBe(200);expect(await response.json()).toEqual({checked:2,changed:1});expect(m.reroute).toHaveBeenCalledWith("org");expect(response.headers.get("cache-control")).toBe("private, no-store");
});
