import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), account: vi.fn(), clients: vi.fn(), directory: vi.fn(), tickets: vi.fn(), client: vi.fn(), entry: vi.fn(), lock: vi.fn(), link: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { client: { findMany: m.clients, findFirst: m.client }, whatsAppDirectoryEntry: { findMany: m.directory, findFirst: m.entry }, serviceTicket: { findMany: m.tickets }, $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.lock, clientWhatsAppIdentity: { upsert: m.link }, serviceTicket: { updateMany: m.update } }) } }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: m.member, getWhatsAppPermission: m.permission }));
vi.mock("@/modules/whatsapp/account-scope", () => ({ currentWhatsAppAccount: m.account }));
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); m.member.mockResolvedValue({ organizationId: "org", role: "MANAGER" }); m.permission.mockResolvedValue({ canView: true, canManage: true, canEdit: true }); m.account.mockResolvedValue({ recipient: "wa-account:c:5511", connection: { id: "c", phone: "5511" }, where: { organizationId: "org", source: "WHATSAPP_API", recipientEmail: "wa-account:c:5511" } }); for (const query of [m.clients, m.directory, m.tickets]) query.mockResolvedValue([]); m.client.mockResolvedValue({ id: "client", name: "Cliente", serviceSquad: "SQUAD_1" }); m.entry.mockResolvedValue({ kind: "GROUP", externalId: "new@g.us", displayName: "Novo grupo" }); m.lock.mockResolvedValue([{ id: "c" }]); m.update.mockResolvedValue({ count: 1 }); });
it.each(["OPERATOR", "CLIENT"])("blocks %s even with a configured management module permission", async role => { m.member.mockResolvedValue({ role, organizationId: "org" }); expect((await GET()).status).toBe(403); expect(m.clients).not.toHaveBeenCalled(); });
it.each(["MASTER", "ADMIN", "MANAGER"])("allows %s and scopes the active base and account", async role => { m.member.mockResolvedValue({ role, organizationId: "org" }); expect((await GET()).status).toBe(200); expect(m.clients.mock.calls[0][0].where).toEqual({ organizationId: "org", active: true }); expect(m.directory.mock.calls[0][0].where).toMatchObject({ organizationId: "org", accountPhone: "5511", active: true }); expect(m.tickets.mock.calls[0][0].where.recipientEmail).toBe("wa-account:c:5511"); });
it("rejects disconnected accounts instead of showing misleading zero coverage", async () => { m.account.mockResolvedValue({ recipient: null }); expect((await GET()).status).toBe(409); expect(m.clients).not.toHaveBeenCalled(); });
const link = (body: unknown = { clientId: "client", entryId: "entry" }) => POST(new Request("https://hub.test/api/whatsapp/client-links", { method: "POST", body: JSON.stringify(body) }));
it("does not allow an operator or a manager without editing access to add a link", async () => {
  m.member.mockResolvedValueOnce({ organizationId: "org", role: "OPERATOR" }); expect((await link()).status).toBe(403);
  m.permission.mockResolvedValue({ canView: true, canEdit: false }); expect((await link()).status).toBe(403); expect(m.link).not.toHaveBeenCalled();
});
it("rejects malformed input and unavailable clients or directory entries", async () => {
  expect((await link({ clientId: "client" })).status).toBe(400); m.entry.mockResolvedValueOnce(null); expect((await link()).status).toBe(404); expect(m.link).not.toHaveBeenCalled();
  expect(m.entry.mock.calls[0][0].where).toMatchObject({ organizationId: "org", connectionId: "c", accountPhone: "5511", active: true });
  expect(m.client.mock.calls[0][0].where).toEqual({ id: "client", organizationId: "org", active: true });
});
it("adds a new identity idempotently while preserving the client's previous group and contact links", async () => {
  const links = new Map<string, unknown>([["previous-group", {}], ["previous-contact", {}]]);
  m.link.mockImplementation(async args => { links.set(JSON.stringify(args.where.organizationId_clientId_kind_externalId), args.create); });
  expect((await link()).status).toBe(200); expect((await link()).status).toBe(200); expect(links.size).toBe(3);
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { recipientEmail: "wa-account:c:5511", organizationId: "org", senderEmail: "wa-group:new@g.us", clientId: null }, data: { clientId: "client" } });
  expect(m.update.mock.calls[0][0].data).not.toHaveProperty("assignedToId");
});
it("does not save a link if the connected physical account changes during submission", async () => { m.lock.mockResolvedValue([]); expect((await link()).status).toBe(409); expect(m.link).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); });
