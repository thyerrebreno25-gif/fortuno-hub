import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permission: vi.fn(), findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), audit: vi.fn() }));
vi.mock("@/modules/atendimento/auth", () => ({ getServiceCenterMember: mocks.member, getServiceCenterPermission: mocks.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: async (run: (tx: unknown) => unknown) => run({ serviceTicket: { findMany: mocks.findMany, deleteMany: mocks.deleteMany, count: mocks.count }, auditLog: { create: mocks.audit }, serviceTicketHistory: { createMany: mocks.createMany, updateMany: mocks.updateMany } }) } }));
import { POST, DELETE } from "./route";
const request = (action: string) => new Request("https://example.test/api/atendimento/archive", { method: "POST", body: JSON.stringify({ action }) });
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue({ userId: "u", organizationId: "org", role: "MASTER" }); mocks.permission.mockResolvedValue({ canManage: true }); mocks.findMany.mockResolvedValue([{ id: "ticket" }]); mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.deleteMany.mockResolvedValue({count:1});mocks.count.mockResolvedValue(0); });
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
  expect(mocks.findMany).toHaveBeenCalledWith({ where: { organizationId: "org", source: { in: ["GMAIL", "MANUAL"] }, history: { none: { type: "MAILBOX_ARCHIVED" } } }, select: { id: true } });
  expect(mocks.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ ticketId: "ticket", userId: "u", type: "MAILBOX_ARCHIVED" })] });
});
it("restores only the current organization's archive markers", async () => {
  expect((await POST(request("restore"))).status).toBe(200);
  expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { type: "MAILBOX_ARCHIVED", ticket: { organizationId: "org", source: { in: ["GMAIL", "MANUAL"] } } } }));
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
it("deletes a bounded batch of archived email tickets and audits the committed count", async () => {
  const response=await DELETE(deletion());
  const body=await response.json();
  expect(body).toMatchObject({count:1,remaining:0});expect(Number.isFinite(Date.parse(body.cutoff))).toBe(true);
  const where={organizationId:"org",source:{in:["GMAIL","MANUAL"]},createdAt:{lte:new Date(body.cutoff)},lastMessageAt:{lte:new Date(body.cutoff)},history:{some:{type:"MAILBOX_ARCHIVED",createdAt:{lte:new Date(body.cutoff)}}}};
  expect(mocks.findMany).toHaveBeenCalledWith({where,select:{id:true},orderBy:{id:"asc"},take:50});
  expect(mocks.deleteMany).toHaveBeenCalledWith({where:{...where,id:{in:["ticket"]}}});
  expect(mocks.count).toHaveBeenCalledWith({where});
  expect(mocks.audit).toHaveBeenCalledWith({data:expect.objectContaining({userId:"u",action:"DELETE_ARCHIVED_MAILBOX",afterData:{organizationId:"org",deleted:1,cutoff:body.cutoff,batchSize:50}})});
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("uses the same cutoff on following batches and cannot include new emails or new archive markers", async()=>{
  const cutoff="2026-11-01T12:00:00.000Z";
  await DELETE(new Request("https://hub.test/api/atendimento/archive",{method:"DELETE",body:JSON.stringify({confirmation:"EXCLUIR ARQUIVADOS",cutoff})}));
  expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({createdAt:{lte:new Date(cutoff)},lastMessageAt:{lte:new Date(cutoff)},history:{some:{type:"MAILBOX_ARCHIVED",createdAt:{lte:new Date(cutoff)}}}});
});
it.each(["invalid","2999-01-01T00:00:00.000Z",123,null])("rejects an invalid cutoff %s before deleting",async cutoff=>{
  expect((await DELETE(new Request("https://hub.test/api/atendimento/archive",{method:"DELETE",body:JSON.stringify({confirmation:"EXCLUIR ARQUIVADOS",cutoff})}))).status).toBe(400);
  expect(mocks.deleteMany).not.toHaveBeenCalled();
});
it("returns a JSON error for a timed-out batch without reporting success",async()=>{
  mocks.deleteMany.mockRejectedValueOnce({code:"P2028"});
  const response=await DELETE(deletion());expect(response.status).toBe(503);expect((await response.json()).error).toContain("lotes já confirmados");expect(mocks.audit).not.toHaveBeenCalled();
});
it("finishes an empty archive without a fake deletion or audit record",async()=>{
  mocks.findMany.mockResolvedValueOnce([]);const body=await(await DELETE(deletion())).json();expect(body).toMatchObject({count:0,remaining:0});expect(mocks.deleteMany).not.toHaveBeenCalled();expect(mocks.audit).not.toHaveBeenCalled();
});
