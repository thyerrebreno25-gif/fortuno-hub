import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ client: vi.fn(), member: vi.fn(), permission: vi.fn(), change: vi.fn(), history: vi.fn(), message: vi.fn(), relink: vi.fn(), identity: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { client: { findFirst: m.client }, organizationMember: { findFirst: m.member }, $transaction: m.transaction } }));
vi.mock("@/modules/atendimento/auth", () => ({ getWhatsAppPermission: m.permission }));
import { transferWhatsappTicket } from "./transfer";
import type { getWhatsappTicket } from "./server";
type Ticket = NonNullable<Awaited<ReturnType<typeof getWhatsappTicket>>>;
const current = { id: "ticket", organizationId: "org", status: "IN_PROGRESS", assignedToId: "me", clientId: "client", senderEmail: "wa-group:group@g.us", senderName: "Grupo do cliente", routingArea: "GENERAL", routingSquad: "SQUAD_1" } as Ticket;
const actor = { organizationId: "org", userId: "me", user: { name: "Operador", email: "operator@example.test" } };
const client = { id: "client", name: "Cliente", serviceSquad: null, payableResponsibleId: "payable", receivableResponsibleId: "receivable", generalResponsibleId: "general", operationLeaderId: "leader" };
beforeEach(() => {
  vi.clearAllMocks(); m.client.mockResolvedValue(client); m.member.mockResolvedValue({ role: "OPERATOR", user: { name: "Responsável", email: "target@example.test" } }); m.permission.mockResolvedValue({ canView: true, canEdit: true }); m.change.mockResolvedValue({ count: 1 });
  m.transaction.mockImplementation(async (fn) => fn({ serviceTicket: { updateMany: m.change }, serviceTicketHistory: { create: m.history }, serviceMessage: { create: m.message }, clientWhatsAppIdentity: { updateMany: m.relink, upsert: m.identity } }));
});
describe("WhatsApp conversation transfers", () => {
  it("replaces the current assignee with the client's payable owner", async () => {
    await transferWhatsappTicket(current, actor, false, { mode: "AREA", routingArea: "ACCOUNTS_PAYABLE", note: "Conferir boleto" });
    expect(m.change.mock.calls[0][0].data).toMatchObject({ assignedToId: "payable", routingArea: "ACCOUNTS_PAYABLE", status: "IN_PROGRESS" });
    expect(m.history.mock.calls[0][0].data.metadata).toMatchObject({ previousAssignedToId: "me", assignedToId: "payable", note: "Conferir boleto" });
    expect(m.message.mock.calls[0][0].data).toMatchObject({ direction: "INTERNAL", toEmails: [] });
    expect(m.message.mock.calls[0][0].data.textBody).toContain("Conferir boleto");
  });
  it("selects the receivable owner for receivable requests", async () => {
    await transferWhatsappTicket(current, actor, false, { mode: "AREA", routingArea: "ACCOUNTS_RECEIVABLE" }); expect(m.change.mock.calls[0][0].data.assignedToId).toBe("receivable");
  });
  it("does not silently send payable requests to the general owner", async () => {
    m.client.mockResolvedValueOnce({ ...client, payableResponsibleId: null }); await expect(transferWhatsappTicket(current, actor, false, { mode: "AREA", routingArea: "ACCOUNTS_PAYABLE" })).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("allows manual transfers while preserving the client and existing area", async () => {
    await transferWhatsappTicket(current, actor, false, { mode: "OPERATOR", assignedToId: "other" }); expect(m.change.mock.calls[0][0].data).toMatchObject({ assignedToId: "other", clientId: "client", routingArea: "GENERAL" });
  });
  it("prevents an operator from transferring another operator's conversation", async () => {
    await expect(transferWhatsappTicket({ ...current, assignedToId: "other" }, actor, false, { mode: "OPERATOR", assignedToId: "payable" })).rejects.toMatchObject({ status: 403 }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("allows an authorized manager to transfer an occupied conversation", async () => {
    await transferWhatsappTicket({ ...current, assignedToId: "other" }, actor, true, { mode: "OPERATOR", assignedToId: "payable" }); expect(m.change.mock.calls[0][0].where.assignedToId).toBe("other");
  });
  it("refuses conversations from another organization", async () => {
    await expect(transferWhatsappTicket({ ...current, organizationId: "other" }, actor, true, { mode: "OPERATOR", assignedToId: "payable" })).rejects.toMatchObject({ status: 404 }); expect(m.client).not.toHaveBeenCalled();
  });
  it("requires an active client from the same organization", async () => {
    m.client.mockResolvedValueOnce(null); await expect(transferWhatsappTicket(current, actor, true, { mode: "AREA", routingArea: "ACCOUNTS_PAYABLE", clientId: "foreign" })).rejects.toMatchObject({ status: 400 }); expect(m.client.mock.calls[0][0].where).toMatchObject({ organizationId: "org", active: true }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("requires a client before automatic area routing", async () => {
    await expect(transferWhatsappTicket({ ...current, clientId: null }, actor, false, { mode: "AREA", routingArea: "ACCOUNTS_PAYABLE" })).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("rejects destinations outside the organization's staff", async () => {
    m.member.mockResolvedValueOnce(null); await expect(transferWhatsappTicket(current, actor, false, { mode: "OPERATOR", assignedToId: "foreign" })).rejects.toMatchObject({ status: 400 }); expect(m.member.mock.calls[0][0].where).toMatchObject({ organizationId: "org", role: { not: "CLIENT" } }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("does not assign conversations to operators without WhatsApp access", async () => {
    m.permission.mockResolvedValueOnce({ canView: true, canEdit: false }); await expect(transferWhatsappTicket(current, actor, false, { mode: "OPERATOR", assignedToId: "other" })).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("refuses a finalized conversation", async () => {
    await expect(transferWhatsappTicket({ ...current, status: "RESOLVED" }, actor, true, { mode: "OPERATOR", assignedToId: "other" })).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("does not overwrite a simultaneous claim by another operator", async () => {
    m.change.mockResolvedValueOnce({ count: 0 }); await expect(transferWhatsappTicket(current, actor, false, { mode: "OPERATOR", assignedToId: "other" })).rejects.toMatchObject({ status: 409 }); expect(m.history).not.toHaveBeenCalled(); expect(m.message).not.toHaveBeenCalled();
  });
  it("remembers the selected client only for the transferred chat identity", async () => {
    await transferWhatsappTicket({ ...current, clientId: null }, actor, false, { mode: "AREA", clientId: "client", routingArea: "ACCOUNTS_PAYABLE" });
    expect(m.relink.mock.calls[0][0].where).toEqual({ organizationId: "org", kind: "GROUP", externalId: "group@g.us", clientId: { not: "client" } }); expect(m.identity.mock.calls[0][0].create.clientId).toBe("client");
  });
  it("rejects oversized notes before writing any data", async () => {
    await expect(transferWhatsappTicket(current, actor, false, { mode: "OPERATOR", assignedToId: "other", note: "x".repeat(1001) })).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
  });
});
