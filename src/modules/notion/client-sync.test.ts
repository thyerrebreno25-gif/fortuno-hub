import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ fetch: vi.fn(), token: vi.fn(), reroute: vi.fn(), transaction: vi.fn(), connection: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() }, client: { findMany: vi.fn(), updateMany: vi.fn() }, members: { findMany: vi.fn() }, management: { upsert: vi.fn() }, identities: { upsert: vi.fn() }, audit: { create: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: { notionConnection: m.connection, client: m.client, organizationMember: m.members, $transaction: m.transaction } }));
vi.mock("./server", () => ({ notionFetch: m.fetch, notionToken: m.token, NotionError: class extends Error {} }));
vi.mock("@/modules/atendimento/routing/reprocess", () => ({ rerouteGmailTickets: m.reroute }));
import { syncNotionClients } from "./client-sync";
const client = { id: "client", name: "Abismo Anhumas", document: "12345678000190", serviceAliases: null, payableResponsibleId: null, receivableResponsibleId: null, generalResponsibleId: null, operationLeaderId: null, notionSquad: null, cluster: "C", updatedAt: new Date(), management: null };
const schema = { properties: { "Contas a Pagar": {}, "Contas a Receber": {}, Supervisão: {} } };
const page = { id: "page", properties: { "Razão Social": { type: "title", title: [{ plain_text: client.name }] }, CNPJ: { type: "rich_text", rich_text: [{ plain_text: client.document }] }, "Contas a Pagar": { type: "select", select: { name: "Duda" } }, "Contas a Receber": { type: "select", select: { name: "Luana Cordeiro" } }, Supervisão: { type: "select", select: { name: "Pedro" } }, Squad: { type: "select", select: { name: "Força Tática Financeira" } } } };
beforeEach(() => {
  vi.resetAllMocks(); m.connection.updateMany.mockResolvedValue({ count: 1 }); m.connection.findUniqueOrThrow.mockResolvedValue({ clientSourceId: "source", connectedById: "admin", clientSyncConfig: { aliases: { Duda: "Eduarda Rocha" } }, clientSyncState: {} });
  m.token.mockResolvedValue("private-token"); m.fetch.mockResolvedValueOnce(schema).mockResolvedValueOnce({ results: [page], has_more: false }); m.client.findMany.mockResolvedValue([client]); m.client.updateMany.mockResolvedValue({ count: 1 }); m.reroute.mockResolvedValue({ checked: 1, changed: 1 });
  m.members.findMany.mockResolvedValue([{ user: { id: "ap", name: "Eduarda Rocha", email: "ap@test.com" } }, { user: { id: "ar", name: "Luana Cordeiro", email: "ar@test.com" } }, { user: { id: "leader", name: "Pedro Duarte", email: "leader@test.com" } }]);
  m.transaction.mockImplementation(async (run) => run({ client: m.client, clientManagement: m.management, clientEmailIdentity: m.identities, notionConnection: m.connection, auditLog: m.audit }));
});
it("persists real user ids, supervisor fallback, squad and Notion provenance", async () => {
  const result = await syncNotionClients("org", true);
  expect(result).toMatchObject({ total: 1, matched: 1, updated: 1 });
  expect(m.client.updateMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: "org", id: "client", updatedAt: client.updatedAt }, data: { payableResponsibleId: "ap", receivableResponsibleId: "ar", operationLeaderId: "leader", generalResponsibleId: "leader", notionSquad: "Força Tática Financeira" } });
  expect(m.management.upsert.mock.calls[0][0].create).toMatchObject({ organizationId: "org", notionPageId: "page" }); expect(m.reroute).toHaveBeenCalledExactlyOnceWith("org");
});
it("never overwrites an operator's manual correction after a previous sync", async () => {
  m.client.findMany.mockResolvedValueOnce([{ ...client, payableResponsibleId: "manually-selected" }]);
  m.connection.findUniqueOrThrow.mockResolvedValueOnce({ clientSourceId: "source", connectedById: "admin", clientSyncConfig: { aliases: { Duda: "Eduarda Rocha" } }, clientSyncState: { client: { applied: { payableResponsibleId: "old-ap" } } } });
  expect(await syncNotionClients("org", true)).toMatchObject({ pending: 1 });
  expect(m.client.updateMany.mock.calls[0][0].data.payableResponsibleId).toBeUndefined();
});
it("does not change duplicated companies", async () => {
  m.fetch.mockReset().mockResolvedValueOnce(schema).mockResolvedValueOnce({ results: [page, { ...page, id: "duplicate" }], has_more: false });
  expect(await syncNotionClients("org", true)).toMatchObject({ matched: 0, updated: 0, pending: 1 }); expect(m.client.updateMany).not.toHaveBeenCalled();
});
it("respects the distributed lease without querying Notion twice", async () => {
  m.connection.updateMany.mockResolvedValueOnce({ count: 0 }); expect(await syncNotionClients("org", true)).toEqual({ skipped: true }); expect(m.fetch).not.toHaveBeenCalled();
});
it("preserves cadastros when the source cannot be fully read", async () => {
  m.fetch.mockReset().mockResolvedValueOnce(schema).mockRejectedValueOnce(new Error("provider unavailable"));
  expect(await syncNotionClients("org", true)).toHaveProperty("error"); expect(m.client.updateMany).not.toHaveBeenCalled(); expect(m.connection.update).toHaveBeenLastCalledWith({ where: { organizationId: "org" }, data: { clientSyncLeaseUntil: null } });
});
