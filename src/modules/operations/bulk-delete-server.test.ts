import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), row: vi.fn(), activities: vi.fn(), timers: vi.fn(), stop: vi.fn(), events: vi.fn(), remove: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { deleteSelectedActivities } from "./bulk-delete-server";
import { bulkActivityDeletionSchema, selectedActivityDeletion } from "./bulk-delete-model";
const now = new Date("2026-11-17T18:00:00Z"), updatedAt = "2026-11-17T12:00:00.000Z";
const member = { userId: "manager", organizationId: "org", role: "MANAGER", canEdit: true, user: { name: "Gestora", email: "m@test" } } as never;
const input = { day: "2026-11-17", reason: "Atividades duplicadas do dia", activities: [{ id: "a", updatedAt }, { id: "b", updatedAt }] };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  m.transaction.mockImplementation(async run => run({ $executeRaw: m.lock, $queryRaw: m.row, operationActivity: { findMany: m.activities, updateMany: m.remove }, operationTimeEntry: { findMany: m.timers, update: m.stop }, operationEvent: { createMany: m.events } }));
  m.activities.mockResolvedValue(input.activities.map(activity => ({ ...activity, updatedAt: new Date(updatedAt) }))); m.timers.mockResolvedValue([]); m.remove.mockResolvedValue({ count: 2 });
});
afterEach(() => vi.useRealTimers());
it("deletes only selected activities on exactly one day and organization, retaining their history and routine links", async () => {
  expect(await deleteSelectedActivities(member, input)).toEqual({ deleted: 2, day: input.day });
  expect(m.activities.mock.calls[0][0].where).toMatchObject({ id: { in: ["a", "b"] }, organizationId: "org", deletedAt: null, scheduledDate: { gte: new Date("2026-11-17T00:00:00Z"), lt: new Date("2026-11-18T00:00:00Z") } });
  expect(m.remove.mock.calls[0][0].data).toEqual({ deletedAt: now, deletedById: "manager", deletionReason: input.reason });
  expect(m.events.mock.calls[0][0].data).toHaveLength(2);
  expect(m.events.mock.calls[0][0].data[0]).toMatchObject({ activityId: "a", userId: "manager", type: "ACTIVITY_DELETED", metadata: { batch: true, day: input.day, reason: input.reason } });
  expect(m.lock.mock.calls[0][1]).toBe("operations-reset-org");
  expect(m.row.mock.calls[0][0].sql).toContain("FOR UPDATE");
});
it("closes the selected tasks' running timers with their actual elapsed time before deletion", async () => {
  m.timers.mockResolvedValue([{ id: "timer", startedAt: new Date(+now - 125000) }]);
  await deleteSelectedActivities(member, input);
  expect(m.timers.mock.calls[0][0].where).toEqual({ activityId: { in: ["a", "b"] }, endedAt: null });
  expect(m.stop.mock.calls[0][0]).toMatchObject({ where: { id: "timer" }, data: { endedAt: now, seconds: 125 } });
});
it("refuses mixed-day, foreign or already deleted selections without partially deleting anything", async () => {
  m.activities.mockResolvedValue([{ id: "a", updatedAt: new Date(updatedAt) }]);
  await expect(deleteSelectedActivities(member, input)).rejects.toMatchObject({ status: 409 });
  expect(m.remove).not.toHaveBeenCalled(); expect(m.events).not.toHaveBeenCalled(); expect(m.timers).not.toHaveBeenCalled();
});
it("rejects concurrent activity edits after the user reviewed the list", async () => {
  m.activities.mockResolvedValue([{ id: "a", updatedAt: now }, { id: "b", updatedAt: new Date(updatedAt) }]);
  await expect(deleteSelectedActivities(member, input)).rejects.toMatchObject({ status: 409 }); expect(m.remove).not.toHaveBeenCalled();
});
it.each(["OPERATOR", "CLIENT"])("refuses %s deletion and write-disabled profiles before starting a transaction", async role => {
  await expect(deleteSelectedActivities({ ...member as object, role } as never, input)).rejects.toMatchObject({ status: 403 });
  await expect(deleteSelectedActivities({ ...member as object, canEdit: false } as never, input)).rejects.toMatchObject({ status: 403 });
  expect(m.transaction).not.toHaveBeenCalled();
});
it("requires unique explicit IDs, a valid day and a justification", async () => {
  for (const patch of [{ activities: [] }, { activities: [input.activities[0], input.activities[0]] }, { reason: " " }]) expect(bulkActivityDeletionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  await expect(deleteSelectedActivities(member, { ...input, day: "2026-02-30" })).rejects.toMatchObject({ status: 400 }); expect(m.transaction).not.toHaveBeenCalled();
});
it("deletes the exact list selection across different dates or without scheduled dates, without requiring a day",async()=>{
 const selected=selectedActivityDeletion(input.activities,input.reason);
 expect(bulkActivityDeletionSchema.safeParse(selected).success).toBe(true);
 expect(selected).not.toHaveProperty("day");
 await deleteSelectedActivities(member,selected);
 expect(m.activities.mock.calls[0][0].where).toEqual({id:{in:["a","b"]},organizationId:"org",deletedAt:null});
 expect(m.remove.mock.calls[0][0].where).toEqual({id:{in:["a","b"]},organizationId:"org",deletedAt:null});
 expect(m.events.mock.calls[0][0].data[0].metadata).toEqual({reason:input.reason,batch:true});
});
it("never widens a list selection when a selected task is unavailable",async()=>{
 m.activities.mockResolvedValue([{id:"a",updatedAt:new Date(updatedAt)}]);
 await expect(deleteSelectedActivities(member,selectedActivityDeletion(input.activities,input.reason))).rejects.toMatchObject({status:409});
 expect(m.remove).not.toHaveBeenCalled();expect(m.events).not.toHaveBeenCalled();
});
