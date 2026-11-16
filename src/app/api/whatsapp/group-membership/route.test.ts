import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),account:vi.fn(),connection:vi.fn(),target:vi.fn(),provider:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("@/modules/whatsapp/group-target",()=>({groupTarget:m.target}));
vi.mock("@/modules/whatsapp/uazapi-server",()=>({whatsappConnection:m.connection}));
vi.mock("@/modules/whatsapp/uazapi",async original=>({...await original<typeof import("@/modules/whatsapp/uazapi")>(),uazapiRequest:m.provider}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({decryptIntegrationSecret:()=>"protected-test"}));
import {POST} from "./route";
const conn={id:"c",instanceId:"instance",phone:"5511888888888",status:"CONNECTED",serverUrl:"https://hub.uazapi.com",tokenEncrypted:"encrypted"};
const account={recipient:"wa-account:c:5511888888888",connection:conn};
const post=(groups=["directory:a","directory:b"],origin="https://hub.test")=>POST(new Request("https://hub.test/api/whatsapp/group-membership",{method:"POST",headers:{origin},body:JSON.stringify({participant:"+55 (11) 99999-9999",groups})}));
beforeEach(()=>{vi.resetAllMocks();m.member.mockResolvedValue({organizationId:"org",role:"MASTER",userId:"master"});m.permission.mockResolvedValue({canView:true,canEdit:true});m.account.mockResolvedValue(account);m.connection.mockResolvedValue(conn);m.target.mockImplementation(async id=>id+"@g.us");});
it("checks selected groups without adding a member or returning private provider payloads",async()=>{
 m.provider.mockResolvedValueOnce({OwnerIsAdmin:true,Participants:[{JID:"5511999999999@s.whatsapp.net"}]}).mockResolvedValueOnce({OwnerIsAdmin:true,Participants:[]});
 const result=await (await post()).json();expect(result.results).toMatchObject([{id:"directory:a",state:"PRESENT",canAdd:false},{id:"directory:b",state:"ABSENT",canAdd:true}]);
 expect(m.provider.mock.calls.every(call=>call[2]==="/group/info"&&call[3].force===true)).toBe(true);expect(JSON.stringify(result)).not.toContain("protected-test");expect(m.target).toHaveBeenCalledWith("directory:a",account,{organizationId:"org",role:"MASTER",userId:"master"},{canView:true,canEdit:true});
});
it("never treats a missing member list, revoked admin rights or inaccessible group as an addable group",async()=>{
 m.provider.mockResolvedValueOnce({OwnerIsAdmin:true}).mockResolvedValueOnce({OwnerIsAdmin:false,Participants:[]});expect((await (await post()).json()).results.map((row:{canAdd:boolean})=>row.canAdd)).toEqual([false,false]);
 m.target.mockRejectedValueOnce(new Error("Assuma o chamado ou solicite a alteração a um gestor."));expect((await (await post(["directory:a"])).json()).results[0].state).toBe("UNKNOWN");
});
it("blocks foreign origins, unauthorized roles, excessive groups and swapped accounts",async()=>{
 expect((await post(undefined,"https://other.test")).status).toBe(403);m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await post()).status).toBe(403);expect((await post(Array.from({length:26},(_,i)=>String(i)))).status).toBe(400);expect(m.provider).not.toHaveBeenCalled();
 m.provider.mockResolvedValue({OwnerIsAdmin:true,Participants:[]});m.account.mockResolvedValueOnce(account).mockResolvedValueOnce({...account,recipient:"changed"});expect((await post()).status).toBe(409);
});
