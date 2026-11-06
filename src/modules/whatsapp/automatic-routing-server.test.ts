import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ list: vi.fn(), route: vi.fn(), lock: vi.fn(), update: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serviceTicket: { findMany: m.list }, $transaction: async (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.lock, serviceTicket: { updateMany: m.update }, serviceTicketHistory: { create: m.history } }) } }));
vi.mock("./server", () => ({ resolveWhatsappRouting: m.route }));
import { reconcileQueuedWhatsapp } from "./automatic-routing-server";
const account = { id: "conn", organizationId: "org", instanceId: "instance", phone: "5511", status: "CONNECTED", expiresAt: null, webhookConfiguredAt: new Date() };
const ticket = { id: "chat", clientId: null, senderEmail: "wa-group:120363123@g.us", senderName: "BPO | Gregorio", subject: "BPO | Gregorio", updatedAt: new Date(), routingArea: "GENERAL", routingReason: null, routingSquad: null, messages: [{ textBody: "Pagar o boleto do fornecedor", attachments: [] }] };
beforeEach(() => { vi.clearAllMocks(); m.list.mockResolvedValue([ticket]); m.route.mockResolvedValue({ clientId: "client", assignedToId: "payable", routingSquad: "team", reason: "Cliente reconhecido." }); m.lock.mockResolvedValue([{ id: "conn" }]); m.update.mockResolvedValue({ count: 1 }); });
it("routes queued work to the area owner only while the ticket and physical account are still current", async () => {
  await reconcileQueuedWhatsapp(account);
  expect(m.list.mock.calls[0][0].where).toMatchObject({ recipientEmail: "wa-account:conn:5511", assignedToId: null });
  expect(m.route.mock.calls[0][0]).toMatchObject({ routingArea: "ACCOUNTS_PAYABLE" });
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { updatedAt: ticket.updatedAt, assignedToId: null, recipientEmail: "wa-account:conn:5511" }, data: { assignedToId: "payable", routingArea: "ACCOUNTS_PAYABLE" } });
  expect(m.history).toHaveBeenCalledOnce();
});
it("does not reassign if the phone changed during classification", async () => { m.lock.mockResolvedValue([]); await reconcileQueuedWhatsapp(account); expect(m.update).not.toHaveBeenCalled(); });
it("does not record a transfer if another operator assumed the ticket concurrently", async () => { m.update.mockResolvedValue({ count: 0 }); await reconcileQueuedWhatsapp(account); expect(m.history).not.toHaveBeenCalled(); });
it("keeps unidentified clients in triage", async () => { m.route.mockResolvedValue({ clientId: null }); await reconcileQueuedWhatsapp(account); expect(m.update).not.toHaveBeenCalled(); });
