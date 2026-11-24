import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permissions:vi.fn(),build:vi.fn(),config:vi.fn(),save:vi.fn()}));
vi.mock("@/modules/assistant/auth",()=>({getMemberForModule:m.member}));vi.mock("@/modules/permissions/permissions",()=>({getRolePermissions:m.permissions}));vi.mock("@/modules/management/operator-report-server",()=>({buildOperatorDayReport:m.build}));vi.mock("@/modules/management/operator-report-delivery",()=>({reportConfig:m.config,saveReportConfig:m.save}));
import {GET,PUT} from "./route";
const member={id:"manager",userId:"me",organizationId:"org",role:"MANAGER"};
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue(member);m.permissions.mockResolvedValue({MANAGEMENT:{canView:true,canManage:true}});m.build.mockResolvedValue({day:"2026-11-23",generatedAt:"2026-11-24T11:00Z",scope:"Minha equipe",rows:[],warnings:[],available:{whatsapp:true,operations:true,daily:true}});m.config.mockResolvedValue({configured:false});});
const get=()=>GET(new Request("https://hub/api/management/operator-report?day=2026-11-23"));
const put=(data:unknown)=>PUT(new Request("https://hub/api/management/operator-report",{method:"PUT",body:JSON.stringify(data)}));
it("restricts previews to managers and uses only server-authenticated organization scope",async()=>{
 for(const role of ["OPERATOR","CLIENT"]){m.member.mockResolvedValueOnce({...member,role});expect((await get()).status).toBe(403);}
 const response=await get();expect(response.status).toBe(200);expect(response.headers.get("Cache-Control")).toBe("private, no-store");expect(m.build).toHaveBeenCalledWith(member,"2026-11-23");expect(m.config).not.toHaveBeenCalled();
});
it("allows only Master/admin with management privileges to configure and rejects forged scope",async()=>{
 expect((await put({destinationName:"Gestores",enabled:true})).status).toBe(403);m.member.mockResolvedValue({...member,role:"MASTER"});
 expect((await put({destinationName:"Gestores",enabled:true,organizationId:"another"})).status).toBe(400);
 expect((await put({destinationName:"Gestores",enabled:true,webhook:"https://evil.test/hook"})).status).toBe(400);
 expect((await put({destinationName:"Gestores",enabled:false})).status).toBe(200);expect(m.save).toHaveBeenCalledWith({destinationName:"Gestores",enabled:false,organizationId:"org",userId:"me"});
});
