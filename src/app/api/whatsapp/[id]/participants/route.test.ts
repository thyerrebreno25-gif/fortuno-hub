import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),account:vi.fn(),ticket:vi.fn(),entry:vi.fn(),connection:vi.fn(),request:vi.fn(),create:vi.fn(),update:vi.fn(),invalidate:vi.fn()}));
vi.mock("next/cache",()=>({revalidateTag:m.invalidate}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:m.account}));
vi.mock("@/modules/whatsapp/server",()=>({resolveWhatsappTicketId:vi.fn().mockResolvedValue("ticket")}));
vi.mock("@/modules/whatsapp/uazapi-server",()=>({whatsappConnection:m.connection}));
vi.mock("@/modules/whatsapp/contact-profile",()=>({chatProfileTag:()=>"profile-tag"}));
vi.mock("@/modules/purchase-invoices/server/crypto",()=>({decryptIntegrationSecret:()=>"test-token"}));
vi.mock("@/modules/whatsapp/uazapi",async original=>({...await original<typeof import("@/modules/whatsapp/uazapi")>(),uazapiRequest:m.request}));
vi.mock("@/lib/prisma",()=>({prisma:{serviceTicket:{findFirst:m.ticket},whatsAppDirectoryEntry:{findFirst:m.entry},auditLog:{create:m.create,update:m.update}}}));
import {POST} from "./route";
const phone="5511888888888",participant="5511999999999",group="120363000@g.us",requestId="448e878d-cc2d-4bd0-a069-6907d3f79fb8";
const connection={id:"conn",organizationId:"org",instanceId:"instance",phone,status:"CONNECTED",expiresAt:null,serverUrl:"https://fortunohub.uazapi.com",tokenEncrypted:"encrypted"};
const account={connection,recipient:`wa-account:conn:${phone}`,where:{organizationId:"org",source:"WHATSAPP_API",recipientEmail:`wa-account:conn:${phone}`}};
function post(body:unknown={action:"add",participant,requestId},id="ticket",origin="https://hub.test"){return POST(new Request("https://hub.test/api/whatsapp/"+id+"/participants",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)}),{params:Promise.resolve({id})});}
beforeEach(()=>{
 vi.clearAllMocks();m.member.mockResolvedValue({organizationId:"org",userId:"operator",role:"OPERATOR"});m.permission.mockResolvedValue({canView:true,canEdit:true});m.account.mockResolvedValue(account);m.connection.mockResolvedValue(connection);
 m.ticket.mockResolvedValue({id:"ticket",senderEmail:"wa-group:"+group,recipientEmail:account.recipient,assignedToId:"operator",status:"IN_PROGRESS"});m.entry.mockResolvedValue({externalId:group});m.create.mockResolvedValue({});m.update.mockResolvedValue({});
 m.request.mockImplementation(async(_url,_token,path)=>path==="/group/info"?{JID:group,OwnerIsAdmin:true,Participants:[{JID:phone+"@s.whatsapp.net",IsAdmin:true},{JID:participant+"@s.whatsapp.net",LID:"123456789012345@lid"}]}:{groupUpdated:[{JID:participant+"@s.whatsapp.net",Error:0}]});
});
it("rejects foreign origins, missing sessions, client users and read-only permissions before provider access",async()=>{
 expect((await post(undefined,"ticket","https://evil.test")).status).toBe(403);m.member.mockResolvedValueOnce(null);expect((await post()).status).toBe(401);m.member.mockResolvedValueOnce({organizationId:"org",role:"CLIENT"});expect((await post()).status).toBe(403);m.permission.mockResolvedValueOnce({canView:true,canEdit:false});expect((await post()).status).toBe(403);expect(m.request).not.toHaveBeenCalled();
});
it("scopes ticket reads to the exact tenant, source and connected number",async()=>{m.ticket.mockResolvedValue(null);expect((await post()).status).toBe(404);expect(m.ticket.mock.calls[0][0].where).toMatchObject({id:"ticket",...account.where,mergedIntoId:null,isSpam:false});expect(m.request).not.toHaveBeenCalled();});
it("does not allow another operator to manage a colleague's group",async()=>{m.ticket.mockResolvedValue({id:"ticket",senderEmail:"wa-group:"+group,assignedToId:"other",status:"IN_PROGRESS"});expect((await post()).status).toBe(403);expect(m.request).not.toHaveBeenCalled();});
it("rejects an inactive or changed connection",async()=>{m.account.mockResolvedValueOnce({...account,recipient:null});expect((await post()).status).toBe(409);m.connection.mockResolvedValue({...connection,phone:"5511777777777"});expect((await post()).status).toBe(409);expect(m.request).not.toHaveBeenCalled();});
it("fetches fresh admin rights and stops when group admin permission has been revoked",async()=>{m.request.mockResolvedValueOnce({OwnerIsAdmin:false,Participants:[]});expect((await post()).status).toBe(403);expect(m.request).toHaveBeenCalledWith(connection.serverUrl,"test-token","/group/info",{groupjid:group,force:true});expect(m.create).not.toHaveBeenCalled();});
it("removes a selected current member by LID and records confirmation, without returning provider secrets",async()=>{
 const response=await post({action:"remove",participant:"123456789012345@lid",requestId});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true});expect(m.request.mock.calls[1].slice(2)).toEqual(["/group/updateParticipants",{groupjid:group,action:"remove",participants:["123456789012345@lid"]}]);expect(m.update.mock.calls[0][0].data.afterData).toMatchObject({state:"CONFIRMED",organizationId:"org",accountRecipient:account.recipient});expect(m.invalidate).toHaveBeenCalledWith("profile-tag",{expire:0});
});
it("rejects removing an absent member, the connected number or the owner",async()=>{
 expect((await post({action:"remove",participant:"5599999999999@s.whatsapp.net",requestId})).status).toBe(400);
 expect((await post({action:"remove",participant:phone+"@s.whatsapp.net",requestId})).status).toBe(400);
 m.request.mockResolvedValueOnce({OwnerIsAdmin:true,OwnerPN:participant+"@s.whatsapp.net",Participants:[{JID:participant+"@s.whatsapp.net"}]});expect((await post({action:"remove",participant:participant+"@s.whatsapp.net",requestId})).status).toBe(400);expect(m.create).not.toHaveBeenCalled();
});
it("does not add a number already in the group",async()=>{expect((await post()).status).toBe(409);expect(m.request).toHaveBeenCalledOnce();expect(m.create).not.toHaveBeenCalled();});
it("adds a normalized number and never reports a privacy refusal as success",async()=>{
 m.request.mockResolvedValueOnce({OwnerIsAdmin:true,Participants:[]}).mockResolvedValueOnce({groupUpdated:[{JID:participant+"@s.whatsapp.net",Error:403,AddRequest:{Code:"private-code"}}]});
 const response=await post({action:"add",participant:"+55 (11) 99999-9999",requestId});expect(response.status).toBe(502);const result=await response.json();expect(result.error).toContain("privacidade");expect(JSON.stringify(result)).not.toContain("private-code");expect(m.request.mock.calls[1][3]).toEqual({groupjid:group,action:"add",participants:[participant]});expect(m.update.mock.calls[0][0].data.afterData.state).toBe("UNCONFIRMED");
});
it("does not retry when a request with the same id is already claimed",async()=>{m.create.mockRejectedValueOnce({code:"P2002"});expect((await post({action:"remove",participant:participant+"@s.whatsapp.net",requestId})).status).toBe(409);expect(m.request).toHaveBeenCalledOnce();});
it("keeps uncertain timeouts unconfirmed and never automatically retries a provider mutation",async()=>{m.request.mockRejectedValueOnce(new Error("offline"));expect((await post()).status).toBe(502);expect(m.create).not.toHaveBeenCalled();m.request.mockResolvedValueOnce({OwnerIsAdmin:true,Participants:[]}).mockRejectedValueOnce(new Error("timeout"));const response=await post();expect(response.status).toBe(502);expect((await response.json()).error).toContain("confirmar");expect(m.update.mock.calls[0][0].data.afterData.state).toBe("UNCONFIRMED");expect(m.request.mock.calls.filter(call=>call[2]==="/group/updateParticipants")).toHaveLength(1);});
it("blocks a number swap during the remote permission check",async()=>{m.account.mockResolvedValueOnce(account).mockResolvedValueOnce({...account,recipient:"changed"});expect((await post({action:"remove",participant:participant+"@s.whatsapp.net",requestId})).status).toBe(409);expect(m.create).not.toHaveBeenCalled();expect(m.request).toHaveBeenCalledOnce();});
it("adds to a directory group without opening a ticket, after manager and exact-account checks",async()=>{
 m.member.mockResolvedValue({organizationId:"org",userId:"manager",role:"MANAGER"});m.ticket.mockResolvedValue(null);m.request.mockResolvedValueOnce({OwnerIsAdmin:true,Participants:[]}).mockResolvedValueOnce({groupUpdated:[{JID:participant+"@s.whatsapp.net",Error:0}]});
 expect((await post(undefined,"directory:group-entry")).status).toBe(200);expect(m.entry.mock.calls[0][0].where).toMatchObject({id:"group-entry",organizationId:"org",connectionId:"conn",accountPhone:phone,active:true,kind:"GROUP"});expect(m.create.mock.calls[0][0].data).toMatchObject({entity:"WhatsAppGroup",entityId:group,userId:"manager"});
});
it("rejects stale directory entries or arbitrary group ids from a different account",async()=>{m.entry.mockResolvedValue(null);expect((await post(undefined,"directory:other-account")).status).toBe(404);expect(m.request).not.toHaveBeenCalled();});
it("rejects malformed actions and contact conversations",async()=>{expect((await post({action:"promote",participant,requestId})).status).toBe(400);m.ticket.mockResolvedValue({senderEmail:"wa-contact:"+participant,assignedToId:"operator",status:"IN_PROGRESS"});expect((await post()).status).toBe(400);expect(m.request).not.toHaveBeenCalled();});
