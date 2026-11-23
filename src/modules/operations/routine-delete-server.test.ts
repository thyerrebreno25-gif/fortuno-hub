import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ configuration: vi.fn(), activities: vi.fn(), transaction: vi.fn(), lock: vi.fn(), rowLock: vi.fn(), stop: vi.fn(), events: vi.fn(), remove: vi.fn(), removeConfiguration: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationClientProcess: { findFirst: m.configuration }, operationActivity: { findMany: m.activities }, $transaction: m.transaction } }));
vi.mock("./auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
import { deleteRoutineSelection, previewRoutineDeletion } from "./routine-delete-server";
const member = { userId: "manager", organizationId: "org", role: "MANAGER", canEdit: true, user: { name: "Gestora", email: "m@test" } } as never;
const date = new Date("2026-11-23T12:00:00Z");
const activities = [{ id: "a", updatedAt: date, status: "OPEN", timeEntries: [] }, { id: "b", updatedAt: date, status: "COMPLETED", timeEntries: [] }];
const input = { reason: "Rotina cadastrada em duplicidade", confirmation: "EXCLUIR ROTINA" };
beforeEach(() => {
  vi.resetAllMocks();
  m.configuration.mockResolvedValue({ id: "routine", updatedAt: date, client: { name: "Cliente" }, process: { name: "Processo" } });
  m.activities.mockResolvedValue(activities);
  m.transaction.mockImplementation(async run => run({ $executeRaw: m.lock, $queryRaw: m.rowLock, operationClientProcess: { findFirst: m.configuration, delete: m.removeConfiguration }, operationActivity: { findMany: m.activities, updateMany: m.remove }, operationTimeEntry: { update: m.stop }, operationEvent: { createMany: m.events } }));
});
it("previews exact routine scope and removes only its confirmed activities, preserving audit records", async () => {
  const preview = await previewRoutineDeletion(member, "routine");
  expect(preview).toMatchObject({ total: 2, completed: 1, running: 0 });
  expect(m.activities.mock.calls[0][0].where).toEqual({ clientProcessId: "routine", organizationId: "org", deletedAt: null });
  expect(await deleteRoutineSelection(member, "routine", { ...input, fingerprint: preview.fingerprint })).toMatchObject({ removedActivities: 2 });
  expect(m.remove.mock.calls[0][0].where).toEqual({ id: { in: ["a", "b"] }, organizationId: "org", clientProcessId: "routine", deletedAt: null });
  expect(m.removeConfiguration).toHaveBeenCalledWith({ where: { id: "routine" } });
  expect(m.events.mock.calls[0][0].data).toHaveLength(2);
  expect(m.rowLock).toHaveBeenCalledTimes(2);
});
it.each(["new activity", "updated activity", "started timer", "updated routine"])("requires a fresh confirmation after %s", async change => {
  const preview = await previewRoutineDeletion(member, "routine");
  if (change === "new activity") m.activities.mockResolvedValue([...activities, { ...activities[0], id: "new" }]);
  if (change === "updated activity") m.activities.mockResolvedValue([{ ...activities[0], updatedAt: new Date(+date + 1000) }, activities[1]]);
  if (change === "started timer") m.activities.mockResolvedValue([{ ...activities[0], timeEntries: [{ id: "timer", startedAt: date }] }, activities[1]]);
  if (change === "updated routine") m.configuration.mockResolvedValue({ id: "routine", updatedAt: new Date(+date + 1000), client: { name: "Cliente" }, process: { name: "Processo" } });
  await expect(deleteRoutineSelection(member, "routine", { ...input, fingerprint: preview.fingerprint })).rejects.toMatchObject({ status: 409 });
  expect(m.removeConfiguration).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); expect(m.stop).not.toHaveBeenCalled();
});
it("rejects operators and managers with read-only access before looking up data", async () => {
  for (const patch of [{ role: "OPERATOR" }, { canEdit: false }]) await expect(previewRoutineDeletion({ ...member as object, ...patch } as never, "routine")).rejects.toMatchObject({ status: 403 });
  expect(m.configuration).not.toHaveBeenCalled();
});
it("refuses an unavailable or foreign routine without deleting anything", async () => {
  m.configuration.mockResolvedValue(null);
  await expect(previewRoutineDeletion(member, "foreign")).rejects.toMatchObject({ status: 404 });
  expect(m.configuration.mock.calls[0][0].where).toEqual({ id: "foreign", client: { organizationId: "org" } });
  expect(m.activities).not.toHaveBeenCalled();
});
