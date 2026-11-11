import {beforeEach,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({member:vi.fn(),permission:vi.fn(),connection:vi.fn(),entry:vi.fn(),activeConnection:vi.fn(),existing:vi.fn(),create:vi.fn(),update:vi.fn(),lock:vi.fn(),transaction:vi.fn()}));
vi.mock("@/modules/atendimento/auth",()=>({getServiceCenterMember:m.member,getWhatsAppPermission:m.permission}));
vi.mock("@/modules/whatsapp/uazapi-server",()=>({whatsappConnection:m.connection}));
vi.mock("@/modules/whatsapp/server",()=>({resolveWhatsappRouting:vi.fn().mockResolvedValue({clientId:null,routingSquad:null,assignedToId:null,reason:"Sem vínculo"})}));
vi.mock("@/lib/prisma",()=>({prisma:{whatsAppDirectoryEntry:{findFirst:m.entry},$transaction:m.transaction}}));
import {POST} from "./route";
const connection={id:"conn",organizationId:"org",phone:"5511888888888",instanceId:"instance",status:"CONNECTED",expiresAt:null};
const run=()=>POST(new Request("https://hub.test/api/whatsapp/directory/entry/open",{method:"POST"}),{params:Promise.resolve({id:"entry"})});
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({organizationId:"org",userId:"operator",role:"OPERATOR"});m.permission.mockResolvedValue({canEdit:true});m.connection.mockResolvedValue(connection);m.entry.mockResolvedValue({externalId:"5511999999999@s.whatsapp.net",displayName:"Contato sem conversa",kind:"CONTACT"});m.activeConnection.mockResolvedValue({id:"conn"});m.existing.mockResolvedValue(null);m.create.mockResolvedValue({id:"new-ticket"});m.transaction.mockImplementation(fn=>fn({$executeRaw:m.lock,whatsAppConnection:{findFirst:m.activeConnection},serviceTicket:{findFirst:m.existing,create:m.create,update:m.update}}));});
it("opens a contact without inventing any message and scopes creation to the connected account",async()=>{
 const response=await run();expect(response.status).toBe(200);expect(await response.json()).toEqual({ticketId:"new-ticket"});
 expect(m.entry.mock.calls[0][0].where).toMatchObject({organizationId:"org",connectionId:"conn",accountPhone:connection.phone,active:true});
 expect(m.create.mock.calls[0][0].data).toMatchObject({source:"WHATSAPP_API",recipientEmail:"wa-account:conn:5511888888888",assignedToId:"operator"});expect(m.create.mock.calls[0][0].data.messages).toBeUndefined();
});
it("reuses the current account's active ticket without changing its assignee",async()=>{
 m.existing.mockResolvedValue({id:"existing"});expect(await(await run()).json()).toEqual({ticketId:"existing"});expect(m.create).not.toHaveBeenCalled();expect(m.existing.mock.calls[0][0].where.recipientEmail).toBe("wa-account:conn:5511888888888");
});
it("does not open entries from another organization or phone",async()=>{m.entry.mockResolvedValue(null);expect((await run()).status).toBe(404);expect(m.transaction).not.toHaveBeenCalled();});
it("requires authentication and edit permission",async()=>{m.member.mockResolvedValueOnce(null);expect((await run()).status).toBe(401);m.permission.mockResolvedValueOnce({canEdit:false});expect((await run()).status).toBe(403);expect(m.entry).not.toHaveBeenCalled();});
it("rejects a connection change before ticket creation",async()=>{m.activeConnection.mockResolvedValue(null);expect((await run()).status).toBe(409);expect(m.create).not.toHaveBeenCalled();});

it("reopens a finalized directory conversation without creating a duplicate",async()=>{m.existing.mockResolvedValueOnce(null).mockResolvedValueOnce({id:"closed"});m.update.mockResolvedValue({id:"closed"});expect(await(await run()).json()).toEqual({ticketId:"closed"});expect(m.create).not.toHaveBeenCalled();expect(m.update.mock.calls[0][0]).toMatchObject({where:{id:"closed"},data:{status:"IN_PROGRESS",assignedToId:"operator",resolvedAt:null}});});
