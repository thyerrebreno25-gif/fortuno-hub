import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ tx: vi.fn(), lock: vi.fn(), find: vi.fn(), update: vi.fn(), event: vi.fn(), unique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
vi.mock("./auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("./activity", () => ({ activityInclude: {} }));
import { editOperationActivity } from "./activity-edit-server";
const member = { userId: "manager", organizationId: "org", role: "MANAGER", canEdit: true, user: { name: "Gestora", email: "m@test" } } as never;
const input = { expectedUpdatedAt: "2026-11-23T12:00:00.000Z", title: "Conferir pagamentos", description: "Conferir comprovantes", day: "2026-11-24", dueTime: "18:00", priority: "HIGH", subjectToFine: false } as const;
beforeEach(() => { vi.resetAllMocks(); m.tx.mockImplementation(async run => run({ $queryRaw: m.lock, operationActivity: { findFirst: m.find, update: m.update, findUnique: m.unique }, operationEvent: { create: m.event } })); m.find.mockResolvedValue({ id: "a", status: "OPEN", updatedAt: new Date(input.expectedUpdatedAt), scheduledDate: null, dueAt: null }); });
it("edits one reviewed task with the Brasília deadline and an audit trail, without changing the routine or timer", async () => {
  await editOperationActivity(member, "a", input);
  expect(m.find.mock.calls[0][0].where).toEqual({ id: "a", organizationId: "org", deletedAt: null });
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { id: "a" }, data: { scheduledDate: new Date("2026-11-24T00:00:00Z"), dueAt: new Date("2026-11-24T21:00:00Z"), title: input.title } });
  expect(m.update.mock.calls[0][0].data).not.toHaveProperty("responsibleId"); expect(m.event).toHaveBeenCalledOnce();
});
it("refuses stale, finalized, pending-review and unauthorized task edits", async () => {
  await expect(editOperationActivity({ ...member as object, role: "OPERATOR" } as never, "a", input)).rejects.toMatchObject({ status: 403 });
  await expect(editOperationActivity(member, "a", { ...input, expectedUpdatedAt: "2026-11-22T12:00:00.000Z" })).rejects.toMatchObject({ status: 409 });
  m.find.mockResolvedValue({ status: "COMPLETED", updatedAt: new Date(input.expectedUpdatedAt) }); await expect(editOperationActivity(member, "a", input)).rejects.toMatchObject({ status: 409 });
  m.find.mockResolvedValue(null); await expect(editOperationActivity(member, "foreign", input)).rejects.toMatchObject({ status: 404 }); expect(m.update).not.toHaveBeenCalled();
});
it("keeps recurring dates in the routine editor so an individual edit cannot recreate the original day",async()=>{
 m.find.mockResolvedValue({id:"a",clientProcessId:"routine",scheduledDate:new Date("2026-11-23T00:00:00Z"),status:"OPEN",updatedAt:new Date(input.expectedUpdatedAt)});
 await expect(editOperationActivity(member,"a",input)).rejects.toMatchObject({status:409});expect(m.update).not.toHaveBeenCalled();
});
