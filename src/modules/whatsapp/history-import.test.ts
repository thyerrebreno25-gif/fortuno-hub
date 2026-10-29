import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ existing: vi.fn(), rebind: vi.fn(), media: vi.fn(), touch: vi.fn(), transaction: vi.fn(), lock: vi.fn(), duplicate: vi.fn(), findTicket: vi.fn(), updateTicket: vi.fn(), createTicket: vi.fn(), createMessage: vi.fn(), createMedia: vi.fn(), history: vi.fn(), classify: vi.fn(), route: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serviceMessage: { findFirst: m.existing, update: m.rebind }, serviceAttachment: { updateMany: m.media }, serviceTicket: { update: m.touch }, $transaction: m.transaction } }));
vi.mock("./uazapi-server", () => ({ checkConnection: vi.fn() }));
vi.mock("@/modules/atendimento/routing/classifier", () => ({ classifyAndRouteEmail: m.classify }));
vi.mock("./server", () => ({ resolveWhatsappRouting: m.route }));
import { receiveMessage } from "./uazapi-events";
import { normalizeUazapiHistory } from "./uazapi";
import type { whatsappConnection } from "./uazapi-server";
const connection = { id: "c", organizationId: "org", phone: "5511999999999", instanceId: "new-instance" } as NonNullable<Awaited<ReturnType<typeof whatsappConnection>>>;
const event = normalizeUazapiHistory({ EventType: "history", event: "messages", messages: [{ id: "owner:msg", messageid: "msg", chatid: "123@g.us", senderName: "Participante", text: "Pagamento", messageTimestamp: Date.parse("2026-10-29T13:00:00Z") }] })[0];
const active = { id: "t", senderName: "Grupo do cliente", assignedToId: "responsible", status: "IN_PROGRESS", clientId: "client", firstResponseAt: null, lastMessageAt: new Date("2026-10-29T12:00:00Z") };
beforeEach(() => {
  vi.clearAllMocks(); m.existing.mockResolvedValue(null); m.duplicate.mockResolvedValue(null); m.findTicket.mockImplementation(async (args) => args.where.status === "RESOLVED" ? null : active); m.updateTicket.mockResolvedValue(active); m.createMessage.mockResolvedValue({ id: "message" }); m.createTicket.mockResolvedValue(active);
  m.classify.mockResolvedValue({ area: "GENERAL", reason: "Conteúdo" }); m.route.mockResolvedValue({ clientId: "client", assignedToId: "general", routingSquad: null, ambiguous: false, reason: "Vínculo" });
  m.transaction.mockImplementation(async (fn) => fn({ $executeRaw: m.lock, serviceMessage: { findFirst: m.duplicate, create: m.createMessage }, serviceTicket: { findFirst: m.findTicket, update: m.updateTicket, create: m.createTicket }, serviceAttachment: { create: m.createMedia }, serviceTicketHistory: { create: m.history } }));
});
describe("Importing missed WhatsApp messages safely", () => {
  it("keeps the existing conversation, client and assigned operator after replacing the instance", async () => {
    await receiveMessage(connection, event); expect(m.createTicket).not.toHaveBeenCalled(); const update = m.updateTicket.mock.calls[0][0].data;
    expect(update.recipientEmail).toBe("wa-account:c:5511999999999"); expect(update).not.toHaveProperty("assignedToId"); expect(update).not.toHaveProperty("clientId"); expect(m.createMessage.mock.calls[0][0].data.externalMessageId).toBe("uazapi:5511999999999:msg");
  });
  it("does not overwrite the latest message preview with an older recovered message", async () => {
    m.findTicket.mockImplementation(async (args) => args.where.status === "RESOLVED" ? null : { ...active, lastMessageAt: new Date("2026-10-29T14:00:00Z") });
    await receiveMessage(connection, event); expect(m.updateTicket.mock.calls[0][0].data).not.toHaveProperty("snippet"); expect(m.updateTicket.mock.calls[0][0].data).not.toHaveProperty("lastMessageAt");
  });
  it("appends historical messages to their finalized conversation without reopening it", async () => {
    m.findTicket.mockResolvedValueOnce({ ...active, status: "RESOLVED", resolvedAt: new Date("2026-10-29T14:00:00Z") });
    await receiveMessage(connection, event); expect(m.createTicket).not.toHaveBeenCalled(); expect(m.updateTicket.mock.calls[0][0].data).not.toHaveProperty("status");
  });
  it("rebinds duplicate messages and media to the replacement instance instead of duplicating them", async () => {
    m.existing.mockResolvedValueOnce({ id: "old-message", ticketId: "t", providerMetadata: { instanceId: "old-instance" } });
    await receiveMessage(connection, { ...event, media: { id: "owner:msg", name: "photo", mimeType: "image/jpeg" } });
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.rebind.mock.calls[0][0].data.providerMetadata).toMatchObject({ instanceId: "new-instance", accountPhone: connection.phone });
    expect(m.media.mock.calls[0][0].data.externalAttachmentId).toBe("uazapi:new-instance:owner:msg"); expect(m.touch.mock.calls[0][0].data).not.toHaveProperty("status");
  });
  it("avoids reprocessing a duplicate already bound to the current instance", async () => {
    m.existing.mockResolvedValueOnce({ id: "m", providerMetadata: { instanceId: connection.instanceId, accountPhone: connection.phone, apiMessageId: event.apiId } });
    await receiveMessage(connection, event); expect(m.rebind).not.toHaveBeenCalled(); expect(m.classify).not.toHaveBeenCalled();
  });
  it("does not rename a historical group using a participant's name", async () => {
    await receiveMessage(connection, event); expect(m.updateTicket.mock.calls[0][0].data.senderName).toBe("Grupo do cliente");
  });
  it("recovers outgoing-only history but ignores unrelated live API echoes", async () => {
    m.findTicket.mockResolvedValue(null); await receiveMessage(connection, { ...event, fromMe: true }); expect(m.createTicket.mock.calls[0][0].data.status).toBe("WAITING_CUSTOMER");
    m.existing.mockClear(); await receiveMessage(connection, { ...event, historical: false, fromMe: true, wasSentByApi: true }); expect(m.existing).not.toHaveBeenCalled();
  });
  it("serializes overlapping live and history deliveries before creating a message", async () => {
    m.duplicate.mockResolvedValueOnce({ id: "already-imported" }); await receiveMessage(connection, event); expect(m.lock).toHaveBeenCalledOnce(); expect(m.createMessage).not.toHaveBeenCalled();
  });
});
