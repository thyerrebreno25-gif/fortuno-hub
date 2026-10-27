import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  fetch: vi.fn(), token: vi.fn(), route: vi.fn(), transaction: vi.fn(),
  connection: { findUniqueOrThrow: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  state: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  message: { findFirst: vi.fn() },
  ticket: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { emailConnection: m.connection, managementSyncState: m.state, serviceMessage: m.message, serviceTicket: m.ticket, $transaction: m.transaction } }));
vi.mock("./client", () => ({ getValidAccessToken: m.token, gmailFetch: m.fetch, GmailApiError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
vi.mock("../routing/classifier", () => ({ classifyAndRouteEmail: m.route }));
vi.mock("../routing/reprocess", () => ({ rerouteGmailTickets: vi.fn() }));
import { GmailApiError } from "./client";
import { pollGmailConnections, syncGmailConnection } from "./sync";
const connection = { id: "box", organizationId: "org", active: true, email: "mail@test.com", externalId: "10", encryptedAccessToken: null, encryptedRefreshToken: null, tokenExpiresAt: null, metadata: { inboxBackfillComplete: true } };
beforeEach(() => { vi.clearAllMocks(); m.state.updateMany.mockResolvedValue({ count: 1 }); m.state.update.mockResolvedValue({}); m.connection.update.mockResolvedValue({}); m.connection.findUniqueOrThrow.mockResolvedValue(connection); m.token.mockResolvedValue("token"); m.message.findFirst.mockResolvedValue({ id: "existing" }); });
it("keeps the original history cursor on every page and commits only the final cursor", async () => {
  m.fetch.mockResolvedValueOnce({ historyId: "20", nextPageToken: "next", history: [{ messagesAdded: [{ message: { id: "a" } }] }] }).mockResolvedValueOnce({ historyId: "25", history: [] });
  await syncGmailConnection(connection, "999");
  expect(m.fetch.mock.calls[0][1]).toContain("startHistoryId=10");
  expect(m.fetch.mock.calls[1][1]).toContain("startHistoryId=10");
  expect(m.connection.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalId: "25" }) }));
  expect(m.transaction).not.toHaveBeenCalled();
});
it("does not advance the cursor or erase the connection on an API failure", async () => {
  m.fetch.mockRejectedValueOnce(new GmailApiError(503, "unavailable"));
  await expect(syncGmailConnection(connection)).rejects.toThrow("Nova tentativa");
  expect(m.connection.update).not.toHaveBeenCalled();
  expect(m.state.update).toHaveBeenLastCalledWith({ where: { id: "gmail-box" }, data: { leaseUntil: null } });
});
it("recovers an expired history with a baseline captured before inbox listing", async () => {
  m.fetch.mockRejectedValueOnce(new GmailApiError(404, "expired")).mockResolvedValueOnce({ historyId: "30" }).mockResolvedValueOnce({ messages: [{ id: "a" }], nextPageToken: "p2" });
  expect(await syncGmailConnection(connection)).toMatchObject({ recovering: true });
  expect(m.fetch.mock.calls[1][1]).toBe("/profile");
  expect(m.fetch.mock.calls[2][1]).toContain("in%3Ainbox");
  const data = m.connection.update.mock.calls.at(-1)![0].data;
  expect(data.externalId).toBeUndefined();
  expect(data.metadata).toMatchObject({ inboxBackfillComplete: false, inboxBackfillHistoryId: "30", inboxBackfillPageToken: "p2" });
});
it("resumes the backfill page and retains its original baseline", async () => {
  m.connection.findUniqueOrThrow.mockResolvedValueOnce({ ...connection, metadata: { inboxBackfillComplete: false, inboxBackfillHistoryId: "15", inboxBackfillPageToken: "p2" } });
  m.fetch.mockResolvedValueOnce({ messages: [] });
  await syncGmailConnection(connection);
  expect(m.fetch.mock.calls[0][1]).toContain("pageToken=p2");
  expect(m.connection.update.mock.calls.at(-1)![0].data).toMatchObject({ externalId: "15", metadata: { inboxBackfillComplete: true, inboxBackfillPageToken: null } });
});
it("does not run a second importer while a database lease is held", async () => {
  m.state.updateMany.mockResolvedValueOnce({ count: 0 });
  expect(await syncGmailConnection(connection)).toMatchObject({ alreadyRunning: true });
  expect(m.fetch).not.toHaveBeenCalled();
});
it("ignores sent messages instead of opening inbound tickets", async () => {
  m.message.findFirst.mockResolvedValueOnce(null);
  m.fetch.mockResolvedValueOnce({ historyId: "20", history: [{ messagesAdded: [{ message: { id: "outgoing" } }] }] }).mockResolvedValueOnce({ id: "outgoing", threadId: "thread", labelIds: ["SENT"] });
  await syncGmailConnection(connection);
  expect(m.route).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
});
it("polling is organization scoped and waits five minutes after a completed attempt", async () => {
  m.connection.findMany.mockResolvedValueOnce([connection]);
  m.state.findUnique.mockResolvedValueOnce({ lastFinishedAt: new Date() });
  expect(await pollGmailConnections("org")).toEqual({ processed: 0, failed: 0 });
  expect(m.connection.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: "org", active: true, provider: "GMAIL" });
  expect(m.fetch).not.toHaveBeenCalled();
});
it("requires reconnection when Google rejects authorization", async () => {
  m.token.mockRejectedValueOnce(new GmailApiError(401, "expired"));
  await expect(syncGmailConnection(connection)).rejects.toThrow("Reconecte");
  expect(m.connection.update).not.toHaveBeenCalled();
});
it.each([false, true])("reopens a resolved ticket only for mail received after resolution (new=%s)", async (isNew) => {
  m.message.findFirst.mockResolvedValueOnce(null);
  m.ticket.findUnique.mockResolvedValueOnce({ id: "ticket", status: "RESOLVED", resolvedAt: new Date("2026-10-25T12:00:00Z"), lastMessageAt: new Date("2026-10-24T12:00:00Z"), snippet: "latest" });
  m.route.mockResolvedValueOnce({});
  const update = vi.fn().mockResolvedValue({});
  m.transaction.mockImplementationOnce(async (run) => run({ serviceTicket: { update }, serviceTicketHistory: { updateMany: vi.fn(), create: vi.fn() }, serviceMessage: { upsert: vi.fn().mockResolvedValue({ id: "message" }) } }));
  const received = isNew ? "2026-10-26T12:00:00Z" : "2026-10-25T10:00:00Z";
  m.fetch.mockResolvedValueOnce({ historyId: "20", history: [{ messagesAdded: [{ message: { id: "incoming" } }] }] }).mockResolvedValueOnce({ id: "incoming", threadId: "thread", labelIds: ["INBOX"], internalDate: String(Date.parse(received)), payload: { headers: [{ name: "From", value: "client@test.com" }] } });
  await syncGmailConnection(connection);
  expect(update.mock.calls[0][0].data.status).toBe(isNew ? "IN_PROGRESS" : undefined);
});
