import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), update: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { whatsAppWebhookInbox: { upsert: m.upsert, updateMany: m.updateMany, findMany: m.findMany, update: m.update } } }));
vi.mock("./uazapi-server", () => ({ checkConnection: m.check }));
vi.mock("./server", () => ({ resolveWhatsappRouting: vi.fn() }));
vi.mock("@/modules/atendimento/routing/classifier", () => ({ classifyAndRouteEmail: vi.fn() }));
import { advancesDelivery, drainUazapiInbox, enqueueUazapiEvent } from "./uazapi-events";
import type { whatsappConnection } from "./uazapi-server";
const connection = { id: "c", organizationId: "org", instanceId: "i" } as NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
beforeEach(() => { vi.clearAllMocks(); m.upsert.mockResolvedValue({}); m.updateMany.mockResolvedValue({ count: 1 }); m.update.mockResolvedValue({}); m.findMany.mockResolvedValue([]); });
describe("Durable Uazapi inbox", () => {
  it("uses the same id for redelivery even if the text or timestamp changed", async () => {
    const event = { kind: "messages" as const, id: "m", apiId: "m", chatId: "123@lid", group: false, fromMe: false, wasSentByApi: false, senderName: "", chatName: "", sender: "", body: "a", timestamp: 1, media: null };
    await enqueueUazapiEvent(connection, event); await enqueueUazapiEvent(connection, { ...event, body: "b", timestamp: 2 });
    expect(m.upsert.mock.calls[0][0].where).toEqual(m.upsert.mock.calls[1][0].where);
    expect(m.upsert.mock.calls[0][0].update).toEqual({});
  });
  it("does not process an event already claimed by another worker", async () => {
    m.findMany.mockResolvedValue([{ id: "e", connection, payload: { instanceId: "i", event: { kind: "connection" } }, status: "PENDING", attempts: 0 }]); m.updateMany.mockResolvedValue({ count: 0 });
    await drainUazapiInbox(); expect(m.check).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("discards an event from a replaced instance", async () => {
    m.findMany.mockResolvedValue([{ id: "e", connection, payload: { instanceId: "old", event: { kind: "connection" } }, status: "PENDING", attempts: 0, eventType: "connection" }]);
    await drainUazapiInbox(); expect(m.check).not.toHaveBeenCalled(); expect(m.update.mock.calls[0][0].data.status).toBe("COMPLETED");
  });
  it("retains failed events for another attempt without exposing provider errors", async () => {
    m.findMany.mockResolvedValue([{ id: "e", connection, payload: { instanceId: "i", event: { kind: "connection" } }, status: "PENDING", attempts: 0 }]); m.check.mockRejectedValueOnce(new Error("private provider detail"));
    await drainUazapiInbox(); expect(m.update.mock.calls[0][0].data.status).toBe("FAILED"); expect(JSON.stringify(m.update.mock.calls)).not.toContain("private provider detail");
  });
  it("does not downgrade delivery receipts arriving out of order", () => {
    expect(advancesDelivery("read", "delivered")).toBe(false); expect(advancesDelivery("delivered", "failed")).toBe(false); expect(advancesDelivery("accepted", "read")).toBe(true); expect(advancesDelivery("failed", "delivered")).toBe(true);
  });
});
