import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ role: "MASTER", identities: new Map<string, unknown>(), current: {} as Record<string, unknown>, sent: vi.fn(), created: vi.fn(), updated: vi.fn(), history: vi.fn(), assignee: vi.fn(), read:vi.fn() }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: async () => ({ organizationId: "org", role: m.role, userId: "operator", user: { id: "operator", name: "Isabella Lago", email: "operator@test" } }), getWhatsAppPermission: async () => ({ canView: true, canEdit: true, canManage: m.role === "MASTER" }), SERVICE_CENTER_MANAGER_ROLES: new Set(["MASTER"]) }));
vi.mock("@/modules/whatsapp/account-scope",()=>({currentWhatsAppAccount:async()=>({recipient:"wa-account:c:5511",connection:{phone:"5511"}})}));
vi.mock("@/modules/whatsapp/conversation-read",()=>({readWhatsAppConversation:m.read,ConversationCursorError:Error}));
vi.mock("@/modules/whatsapp/reopen",()=>({reopenWhatsAppCall:async()=>"new-call",ReopenWhatsAppError:Error}));
vi.mock("@/modules/whatsapp/server", () => ({ getWhatsappTicket: async () => m.current, resolveWhatsappTicketId: async (id: string) => id, eligibleWhatsappResponsible: m.assignee }));
vi.mock("@/modules/whatsapp/uazapi-server", () => ({ whatsappConnection: async () => ({ id: "c", phone: "5511", instanceId: "instance" }), sendUazapiText: m.sent }));
vi.mock("@/modules/whatsapp/transfer", () => ({ transferWhatsappTicket: vi.fn(), WhatsAppTransferError: Error }));
vi.mock("@/modules/whatsapp/merge", () => ({ chatLock: () => "lock" }));
vi.mock("@/lib/prisma", () => {
  const db = { client: { findFirst: async () => ({ id: "client", serviceSquad: null }) }, clientWhatsAppIdentity: { upsert: async (args: { where: { organizationId_clientId_kind_externalId: Record<string, string> }; create: unknown }) => { m.identities.set(JSON.stringify(args.where.organizationId_clientId_kind_externalId), args.create); } }, serviceTicket: { update: m.updated, findFirst: async () => m.current }, serviceTicketHistory: { create: m.history }, serviceMessage: { create: m.created }, $executeRaw: vi.fn() };
  return { prisma: { ...db, $transaction: async (value: ((tx: typeof db) => unknown) | unknown[]) => typeof value === "function" ? value(db) : Promise.all(value) } };
});
import { GET, PATCH } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.role="MASTER"; m.identities.clear(); m.current = { id: "ticket", organizationId: "org", source: "WHATSAPP_API", status: "NEW", senderEmail: "wa-group:group@g.us", senderName: "Grupo", recipientEmail: "wa-account:c:5511", assignedToId: null, messages: [], routingArea: "GENERAL" }; m.read.mockImplementation(async()=>m.current); m.assignee.mockResolvedValue(null); m.sent.mockResolvedValue({ messageId: "uazapi:5511:m", connectionId: "c", accountPhone: "5511", instanceId: "instance" }); });
const patch = (body: unknown) => PATCH(new Request("https://hub.test/api/whatsapp/ticket", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "ticket" }) });
it("preserves multiple group and contact identities when linking the same client", async () => {
  for (const address of ["wa-group:one@g.us", "wa-group:two@g.us", "wa-contact:551100000001", "wa-contact:551100000002"]) { m.current.senderEmail = address; expect((await patch({ action: "client", clientId: "client" })).status).toBe(200); }
  expect(m.identities.size).toBe(4);
});
it("sends the logged-in operator's signature while retaining the operator as the message author", async () => {
  m.current.assignedToId="operator";
  expect((await patch({ action: "reply", content: "Essa não foi efetuada." })).status).toBe(200);
  expect(m.sent.mock.calls[0][0].body).toBe("*Isabella Lago*\nEssa não foi efetuada.");
  expect(m.created.mock.calls[0][0].data).toMatchObject({ fromName: "Isabella Lago", textBody: "Essa não foi efetuada." });
});
it("stores a private comment without sending to Uazapi, assigning the call or recording a customer response",async()=>{
  expect((await patch({action:"comment",content:"Conferir com o financeiro."})).status).toBe(200);
  expect(m.sent).not.toHaveBeenCalled();
  expect(m.created.mock.calls[0][0].data).toMatchObject({direction:"INTERNAL",toEmails:[],textBody:"Conferir com o financeiro.",fromName:"Isabella Lago",providerMetadata:{accountPhone:"5511",type:"WHATSAPP_COMMENT"}});
  expect(m.updated.mock.calls[0][0].data).not.toHaveProperty("firstResponseAt");
  expect(m.updated.mock.calls[0][0].data).not.toHaveProperty("lastMessageAt");
  expect(m.updated.mock.calls[0][0].data).not.toHaveProperty("assignedToId");
});
it("rejects blank or oversized private comments",async()=>{
  expect((await patch({action:"comment",content:"   "})).status).toBe(400);
  expect((await patch({action:"comment",content:"x".repeat(5001)})).status).toBe(400);
  expect(m.created).not.toHaveBeenCalled();expect(m.sent).not.toHaveBeenCalled();
});
it("requires the current user's ownership even for a master before any outgoing send",async()=>{
  for(const assignedToId of [null,"another-operator"]){m.current.assignedToId=assignedToId;expect((await patch({action:"reply",content:"Mensagem"})).status).toBe(403);}
  expect(m.sent).not.toHaveBeenCalled();expect(m.created).not.toHaveBeenCalled();
});
it("allows internal comments in another collaborator's conversation without transferring it",async()=>{
  m.role="OPERATOR"; m.current.assignedToId="another-operator";
  expect((await patch({action:"comment",content:"Observação para a equipe"})).status).toBe(200);
  expect(m.sent).not.toHaveBeenCalled();expect(m.created.mock.calls[0][0].data.direction).toBe("INTERNAL");expect(m.updated.mock.calls[0][0].data).not.toHaveProperty("assignedToId");
});

it("serves the lean authorized conversation snapshot without public caching",async()=>{
 const response=await GET(new Request("https://hub.test/api/whatsapp/ticket?before=older"),{params:Promise.resolve({id:"ticket"})});
 expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
 expect(m.read).toHaveBeenCalledWith("ticket","org","older",expect.objectContaining({recipient:"wa-account:c:5511"}));
});
it("blocks client roles before reading conversation contents",async()=>{
 m.role="CLIENT";expect((await GET(new Request("https://hub.test/api/whatsapp/ticket"),{params:Promise.resolve({id:"ticket"})})).status).toBe(403);expect(m.read).not.toHaveBeenCalled();
});

it("opens a finalized call through the authorized action and returns the actual active id",async()=>{m.current.status="RESOLVED";expect((await patch({action:"reopen"})).status).toBe(200);expect(m.read).toHaveBeenCalledWith("new-call","org");expect(m.sent).not.toHaveBeenCalled();});
