import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ find: vi.fn(), transaction: vi.fn(), lockedFind: vi.fn(), audit: vi.fn(), move: vi.fn(), moveHistory: vi.fn(), alias: vi.fn(), update: vi.fn(), lock: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serviceTicket: { findMany: m.find }, $transaction: m.transaction } }));
import { chooseMerge, duplicatePlan, mergeDuplicates, chatLock } from "./merge";
type Candidate = Parameters<typeof chooseMerge>[0][number];
type Connection = Parameters<typeof duplicatePlan>[0];
const connection = { id: "c", organizationId: "org", phone: "5511999999999" } as Connection;
const ticket = (id: string, changes: Partial<Candidate> = {}): Candidate => ({ id, senderEmail: "wa-group:123@g.us", senderName: "Grupo", assignedToId: null, clientId: null, status: "OPEN", routingArea: "GENERAL", routingSquad: null, recipientEmail: "wa-account:c:5511999999999", snippet: id, createdAt: new Date("2026-10-29T10:00:00Z"), receivedAt: new Date("2026-10-29T10:00:00Z"), lastMessageAt: new Date("2026-10-29T10:00:00Z"), firstResponseAt: null, messages: [{ id: "message-" + id, externalMessageId: id, providerMetadata: { accountPhone: connection.phone } }], history: [{ id: "history-" + id }], ...changes }) as Candidate;
beforeEach(() => {
  vi.clearAllMocks();
  m.move.mockResolvedValue({ count: 1 }); m.moveHistory.mockResolvedValue({ count: 1 }); m.alias.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation(async fn => fn({ $executeRaw: m.lock, $queryRaw: m.rows, serviceTicket: { findMany: m.lockedFind, updateMany: m.alias, update: m.update }, serviceMessage: { updateMany: m.move }, serviceTicketHistory: { create: m.audit, updateMany: m.moveHistory } }));
});
describe("Authorized duplicate consolidation", () => {
  it("keeps the assigned ticket and rejects conflicting owners, clients, accounts and message IDs", () => {
    const a = ticket("a"), b = ticket("b", { assignedToId: "operator" });
    expect(chooseMerge([a,b], connection.phone!).canonical?.id).toBe("b");
    expect(chooseMerge([{ ...a, assignedToId: "other" },b], connection.phone!).conflict).toBe("Responsáveis diferentes");
    expect(chooseMerge([{ ...a, clientId: "x" },{ ...b, clientId: "y" }], connection.phone!).conflict).toBe("Clientes vinculados diferentes");
    expect(chooseMerge([a,{ ...b, messages: [{ ...b.messages[0], providerMetadata: { accountPhone: "other" } }] }], connection.phone!).conflict).toBe("Histórico de outro número");
    expect(chooseMerge([a,{ ...b, messages: a.messages }], connection.phone!).conflict).toBe("IDs de mensagem sobrepostos");
  });
  it("groups exact chat addresses and scopes to active real tickets of this organization and account", async () => {
    m.find.mockResolvedValue([ticket("a"), ticket("b", { senderEmail: "wa-group:456@g.us" })]);
    expect((await duplicatePlan(connection)).groups).toHaveLength(0);
    expect(m.find.mock.calls[0][0].where).toMatchObject({ organizationId: "org", source: "WHATSAPP_API", mergedIntoId: null, isSpam: false, status: { notIn: ["RESOLVED", "SPAM"] } });
  });
  it("invalidates approval when responsibility changes but tolerates newly received messages", async () => {
    const rows = [ticket("a"), ticket("b")]; m.find.mockResolvedValue(rows);
    const initial = await duplicatePlan(connection);
    m.find.mockResolvedValue([rows[0], { ...rows[1], messages: [], lastMessageAt: new Date() }]);
    expect((await duplicatePlan(connection)).fingerprint).toBe(initial.fingerprint);
    m.find.mockResolvedValue([rows[0], { ...rows[1], assignedToId: "new-owner" }]);
    await expect(mergeDuplicates(connection,"user",initial.fingerprint)).rejects.toThrow("mudaram");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("audits original IDs before moving messages and history, preserves owner and aliases old links", async () => {
    const rows = [ticket("a", { assignedToId: "operator", status: "IN_PROGRESS" as Candidate["status"] }), ticket("b", { lastMessageAt: new Date("2026-10-29T12:00:00Z"), clientId: "client" })];
    m.find.mockResolvedValue(rows); m.lockedFind.mockResolvedValue(rows);
    const plan = await duplicatePlan(connection);
    expect(await mergeDuplicates(connection,"user",plan.fingerprint)).toEqual({ merged: 1, messages: 1, skipped: [] });
    expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.move.mock.invocationCallOrder[0]);
    expect(m.audit.mock.calls[0][0].data.metadata.sourceTickets[0]).toMatchObject({ id: "b", messageIds: ["message-b"], historyIds: ["history-b"] });
    expect(m.move).toHaveBeenCalledWith({ where: { ticketId: { in: ["b"] } }, data: { ticketId: "a" } });
    expect(m.alias.mock.calls[0][0].data).toEqual({ mergedIntoId: "a" });
    expect(m.update.mock.calls[0][0].data).toMatchObject({ clientId: "client", snippet: "b" });
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("assignedToId");
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty("status");
  });
  it("rechecks conflicts under lock and leaves the group untouched", async () => {
    const rows = [ticket("a",{ assignedToId: "one" }),ticket("b")]; m.find.mockResolvedValue(rows); m.lockedFind.mockResolvedValue([rows[0],{ ...rows[1], assignedToId: "two" }]);
    const plan = await duplicatePlan(connection);
    expect((await mergeDuplicates(connection,"user",plan.fingerprint)).skipped).toEqual(["Responsáveis diferentes"]);
    expect(m.move).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("uses the same per-chat lock as incoming webhooks", () => {
    expect(chatLock("c","wa-group:123@g.us")).toBe("c123@g.us");
    expect(chatLock("c","wa-contact:5511999999999")).toBe("c5511999999999@s.whatsapp.net");
  });
});

