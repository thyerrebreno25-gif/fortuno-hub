import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), audit: vi.fn() }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: mocks.member, getServiceCenterPermission: mocks.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (run: (tx: unknown) => unknown) => run({ serviceTicket: { findMany: mocks.findMany, deleteMany: mocks.deleteMany }, auditLog: { create: mocks.audit }, serviceTicketHistory: { createMany: mocks.createMany, updateMany: mocks.updateMany } }) } }));
import { POST, DELETE } from "./route";
const request = (action: string) => new Request("https://example.test/api/atendimento/archive", { method: "POST", body: JSON.stringify({ action }) });
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue({ userId: "u", organizationId: "org", role: "MASTER" }); mocks.permission.mockResolvedValue({ canManage: true }); mocks.findMany.mockResolvedValue([{ id: "ticket" }]); mocks.updateMany.mockResolvedValue({ count: 1 }); });
it("requires a signed-in manager", async () => {
  mocks.member.mockResolvedValueOnce(null);
  expect((await POST(request("archive"))).status).toBe(401);
  mocks.permission.mockResolvedValueOnce({ canManage: false });
  expect((await POST(request("archive"))).status).toBe(403);
  expect(mocks.createMany).not.toHaveBeenCalled();
});
it("archives only the current organization's active mailbox without deleting messages", async () => {
  const result = await POST(request("archive"));
  expect(await result.json()).toEqual({ count: 1 });
  expect(mocks.findMany).toHaveBeenCalledWith({ where: { organizationId: "org", history: { none: { type: "MAILBOX_ARCHIVED" } } }, select: { id: true } });
  expect(mocks.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ ticketId: "ticket", userId: "u", type: "MAILBOX_ARCHIVED" })] });
});
it("restores only the current organization's archive markers", async () => {
  expect((await POST(request("restore"))).status).toBe(200);
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "MAILBOX_ARCHIVED", ticket: { organizationId: "org" } } }));
  expect(mocks.createMany).not.toHaveBeenCalled();
});

const deletion = (confirmation = "EXCLUIR ARQUIVADOS") => new Request("https://example.test/api/atendimento/archive", { method: "DELETE", body: JSON.stringify({ confirmation }) });
it("requires authenticated management and explicit confirmation for permanent deletion", async () => {
  mocks.member.mockResolvedValueOnce(null);
  expect((await DELETE(deletion())).status).toBe(401);
  mocks.permission.mockResolvedValueOnce({ canManage: false });
  expect((await DELETE(deletion())).status).toBe(403);
  expect((await DELETE(deletion(""))).status).toBe(400);
  expect(mocks.deleteMany).not.toHaveBeenCalled();
});
it("permanently deletes only archived tickets in the current organization and audits the count", async () => {
  mocks.deleteMany.mockResolvedValueOnce({ count: 1005 });
  expect(await (await DELETE(deletion())).json()).toEqual({ count: 1005 });
  expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org", history: { some: { type: "MAILBOX_ARCHIVED" } } } });
  expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "u", action: "DELETE_ARCHIVED_MAILBOX", afterData: { organizationId: "org", deleted: 1005 } }) });
});
