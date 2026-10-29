import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), find: vi.fn(), create: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("./uazapi-server", () => ({ configureWebhook: vi.fn() }));
vi.mock("./uazapi-events", () => ({ drainUazapiInbox: vi.fn(), enqueueUazapiHistory: vi.fn() }));
vi.mock("@/modules/purchase-invoices/server/crypto", () => ({ decryptIntegrationSecret: vi.fn() }));
import { historyPage, scheduleHistorySync } from "./history-sync";
import { normalizeUazapiHistory } from "./uazapi";
import type { whatsappConnection } from "./uazapi-server";
const connection = { id: "c", organizationId: "org", phone: "5511999999999", status: "CONNECTED", instanceId: "new", expiresAt: null, lastDisconnectedAt: null } as NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T14:00:00Z")); vi.clearAllMocks(); m.find.mockResolvedValue(null); m.legacy.mockResolvedValue(null); m.create.mockImplementation(async ({ data }) => ({ id: "job", ...data }));
  m.transaction.mockImplementation(async (fn) => fn({ $executeRaw: m.lock, whatsAppHistorySync: { findFirst: m.find, create: m.create }, serviceMessage: { findFirst: m.legacy } }));
});
afterEach(() => vi.useRealTimers());
describe("Reconnect reconciliation checkpoints", () => {
  it("starts from the last completed checkpoint of the same phone, with overlap", async () => {
    m.find.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ until: new Date("2026-10-29T12:00:00Z") });
    await scheduleHistorySync(connection); expect(m.create.mock.calls[0][0].data.since.toISOString()).toBe("2026-10-29T11:55:00.000Z");
    expect(m.find.mock.calls[2][0].where).toMatchObject({ connectionId: "c", accountPhone: connection.phone, status: "COMPLETED" });
  });
  it("recovers the gap from the last message of the replaced instance on first migration", async () => {
    m.legacy.mockResolvedValueOnce({ receivedAt: new Date("2026-10-29T12:48:00Z") }); await scheduleHistorySync(connection);
    expect(m.create.mock.calls[0][0].data.since.toISOString()).toBe("2026-10-29T12:43:00.000Z");
    expect(m.legacy.mock.calls[0][0].where.ticket.organizationId).toBe("org");
  });
  it("uses the recorded disconnection if there is no successful checkpoint", async () => {
    await scheduleHistorySync({ ...connection, lastDisconnectedAt: new Date("2026-10-29T13:00:00Z") }); expect(m.create.mock.calls[0][0].data.since.toISOString()).toBe("2026-10-29T12:55:00.000Z");
  });
  it("deduplicates simultaneous sync requests", async () => {
    m.find.mockResolvedValueOnce({ id: "active" }); expect(await scheduleHistorySync(connection, { force: true })).toEqual({ id: "active" }); expect(m.create).not.toHaveBeenCalled(); expect(m.lock).toHaveBeenCalledOnce();
  });
  it("does not reconcile an expired or disconnected instance", async () => {
    expect(await scheduleHistorySync({ ...connection, expiresAt: new Date(0) })).toBeNull(); expect(await scheduleHistorySync({ ...connection, status: "DISCONNECTED" })).toBeNull(); expect(m.transaction).not.toHaveBeenCalled();
  });
});
describe("History pagination and normalization", () => {
  const since = new Date("2026-10-29T12:00:00Z");
  it("keeps both sent and received messages from the disconnected interval", () => {
    const events = normalizeUazapiHistory({ EventType: "history", event: "messages", messages: [
      { id: "incoming", chatid: "5511999999999@s.whatsapp.net", fromMe: false, messageTimestamp: 1793278800000, text: "Recebida" },
      { id: "outgoing", chatid: "5511999999999@s.whatsapp.net", fromMe: true, messageTimestamp: 1793278860000, text: "Enviada" },
    ] });
    expect(events).toHaveLength(2);
    expect(events.map(event => ({ fromMe: event.fromMe, historical: event.historical }))).toEqual([{ fromMe: false, historical: true }, { fromMe: true, historical: true }]);
  });
  it("advances through pages instead of truncating history to the first page", () => {
    expect(historyPage({ messages: [{ messageTimestamp: Date.parse("2026-10-29T13:00:00Z") }], pagination: { hasMore: true, nextOffset: 400 } }, 200, since)).toMatchObject({ done: false, nextOffset: 400 });
  });
  it("stops only when the page passes the cutoff or the provider reports no more pages", () => {
    expect(historyPage({ messages: [{ messageTimestamp: Date.parse("2026-10-29T11:59:00Z") }], pagination: { hasMore: true, nextOffset: 200 } }, 0, since).done).toBe(true);
    expect(historyPage({ messages: [], pagination: { hasMore: false } }, 0, since).done).toBe(true);
  });
  it("refuses a stalled pagination cursor instead of claiming completion", () => {
    expect(() => historyPage({ messages: [{ messageTimestamp: Date.parse("2026-10-29T13:00:00Z") }], pagination: { hasMore: true, nextOffset: 0 } }, 0, since)).toThrow("não avançou");
  });
  it("strips credentials and provider internals from history batches", () => {
    const events = normalizeUazapiHistory({ EventType: "history", event: "messages", token: "private-secret", messages: [{ id: "owner:m", messageid: "m", chatid: "123@g.us", messageTimestamp: 1793278800000, messageType: "ImageMessage", content: JSON.stringify({ mimetype: "image/jpeg", fileName: "foto.jpg", internal: "private-internal" }) }] }, { "123@g.us": "Grupo" });
    expect(events[0]).toMatchObject({ historical: true, id: "m", chatName: "Grupo", media: { mimeType: "image/jpeg", name: "foto.jpg" } }); expect(JSON.stringify(events)).not.toContain("private-"); expect(events[0].body).toBe("[ImageMessage]");
  });
});
