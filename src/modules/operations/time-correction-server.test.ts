import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ activity: vi.fn(), entry: vi.fn(), overlaps: vi.fn(), duplicate: vi.fn(), update: vi.fn(), create: vi.fn(), event: vi.fn(), person: vi.fn(), lock: vi.fn(), row: vi.fn(), transaction: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationTimeEntry: { findFirst: m.entry }, $transaction: m.transaction } }));
import { correctOperationTime } from "./time-correction-server";
const now = new Date("2026-11-17T18:00:00Z"), version = "2026-11-17T15:00:00.000Z";
const member = { userId: "u", organizationId: "org", role: "OPERATOR", canEdit: true, user: { name: "Pessoa", email: "u@test" } } as never;
const input = { entryId: "entry", expectedUpdatedAt: version, startedAt: "2026-11-17T12:00:00Z", endedAt: "2026-11-17T12:30:00Z", reason: "Esqueci de pausar" };
const oldEntry = { id: "entry", activityId: "a", userId: "u", startedAt: new Date("2026-11-17T12:00:00Z"), endedAt: null, seconds: 0, source: "TIMER", description: null, updatedAt: new Date(version) };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  m.transaction.mockImplementation(async run => run({ $executeRaw: m.lock, $queryRaw: m.row, operationActivity: { findFirst: m.activity }, operationTimeEntry: { findFirst: m.entry, findMany: m.overlaps, findUnique: m.duplicate, update: m.update, create: m.create }, organizationMember: { findFirst: m.person }, operationEvent: { create: m.event } }));
  m.activity.mockResolvedValue({ id: "a", responsibleId: "u", status: "COMPLETED" });
  m.entry.mockResolvedValue(oldEntry); m.person.mockResolvedValue({ userId: "u" }); m.overlaps.mockResolvedValue([]); m.duplicate.mockResolvedValue(null);
  m.update.mockImplementation(async ({ data }) => ({ ...oldEntry, ...data }));
  m.create.mockImplementation(async ({ data }) => ({ ...data, description: data.description || null }));
});
afterEach(() => vi.useRealTimers());
it("closes a forgotten timer at its corrected end and atomically audits before/after without reopening the activity", async () => {
  expect((await correctOperationTime(member, "a", input)).seconds).toBe(1800);
  expect(m.lock.mock.calls[0][1]).toBe("operation-timer:u");
  expect(m.row.mock.calls[0].slice(1)).toEqual(["a", "org"]);
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { id: "entry" }, data: { seconds: 1800, source: "CORRECTED" } });
  const audit = m.event.mock.calls[0][0].data;
  expect(audit).toMatchObject({ userId: "u", type: "TIME_ADJUSTED", metadata: { entryId: "entry", entryUserId: "u", before: { endedAt: null, seconds: 0, source: "TIMER" }, after: { seconds: 1800, endedAt: "2026-11-17T12:30:00.000Z" }, previousElapsedSeconds: 21600 } });
  expect(m.entry.mock.calls[0][0].where).toMatchObject({ id: "entry", activityId: "a", activity: { organizationId: "org", deletedAt: null } });
});
it("adds forgotten time once, including a retry, and records its author and reason", async () => {
  const add = { newEntryId: "22c6f4cc-3cc8-479d-a5fb-24f9a05c7340", startedAt: input.startedAt, endedAt: input.endedAt, reason: "Esqueci de iniciar" };
  const saved = await correctOperationTime(member, "a", add);
  expect(saved).toMatchObject({ id: add.newEntryId, userId: "u", source: "MANUAL", seconds: 1800 });
  expect(m.event.mock.calls[0][0].data.metadata.before).toBeNull();
  m.duplicate.mockResolvedValue(saved);
  expect((await correctOperationTime(member, "a", add)).id).toBe(saved.id);
  expect(m.create).toHaveBeenCalledOnce(); expect(m.event).toHaveBeenCalledOnce();
});
it("keeps another operator's entries protected, but lets a manager correct them with attribution intact", async () => {
  m.entry.mockResolvedValue({ ...oldEntry, userId: "other" });
  await expect(correctOperationTime(member, "a", input)).rejects.toMatchObject({ status: 403 });
  expect(m.transaction).not.toHaveBeenCalled();
  await correctOperationTime({ ...member as object, role: "MANAGER" } as never, "a", input);
  expect(m.lock.mock.calls[0][1]).toBe("operation-timer:other");
  expect(m.event.mock.calls[0][0].data).toMatchObject({ userId: "u", metadata: { entryUserId: "other" } });
  expect(m.update.mock.calls[0][0].data.userId).toBeUndefined();
});
it("blocks missing/deleted activities, foreign records and write-disabled profiles before mutation", async () => {
  await expect(correctOperationTime({ ...member as object, canEdit: false } as never, "a", input)).rejects.toMatchObject({ status: 403 });
  m.entry.mockResolvedValueOnce(null);
  await expect(correctOperationTime(member, "a", input)).rejects.toMatchObject({ status: 404 });
  m.activity.mockResolvedValue(null);
  await expect(correctOperationTime(member, "a", input)).rejects.toMatchObject({ status: 404 });
  expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
it("refuses stale edits after a pause/completion or another correction", async () => {
  m.entry.mockResolvedValue({ ...oldEntry, updatedAt: now });
  await expect(correctOperationTime(member, "a", input)).rejects.toMatchObject({ status: 409 });
  expect(m.update).not.toHaveBeenCalled(); expect(m.event).not.toHaveBeenCalled();
});
it("prevents double counting a period against another closed session or running timer", async () => {
  for (const endedAt of [null, new Date("2026-11-17T13:00:00Z")]) {
    m.overlaps.mockResolvedValue([{ startedAt: new Date("2026-11-17T12:10:00Z"), endedAt }]);
    await expect(correctOperationTime(member, "a", input)).rejects.toMatchObject({ status: 409 });
  }
  expect(m.overlaps.mock.calls[0][0].where).toMatchObject({ userId: "u", id: { not: "entry" }, activity: { organizationId: "org", deletedAt: null } });
  expect(m.update).not.toHaveBeenCalled();
});
it("allows zeroing an erroneous entry while retaining its original values in the audit", async () => {
  expect((await correctOperationTime(member, "a", { ...input, endedAt: input.startedAt })).seconds).toBe(0);
  expect(m.event.mock.calls[0][0].data.metadata.after.seconds).toBe(0);
});
it("allows past authors to correct their own time after reassignment but prevents adding time to someone else's task", async () => {
  m.activity.mockResolvedValue({ id: "a", responsibleId: "other" });
  await correctOperationTime(member, "a", input);
  await expect(correctOperationTime(member, "a", { ...input, entryId: undefined, newEntryId: "new" })).rejects.toMatchObject({ status: 403 });
  expect(m.create).not.toHaveBeenCalled();
});
it("rejects future periods and managers selecting a collaborator outside the organization", async () => {
  await expect(correctOperationTime(member, "a", { ...input, endedAt: "2026-11-18T18:00:00Z" })).rejects.toMatchObject({ status: 400 });
  m.person.mockResolvedValue(null);
  await expect(correctOperationTime({ ...member as object, role: "MASTER" } as never, "a", { ...input, entryId: undefined, newEntryId: "new", userId: "foreign" })).rejects.toMatchObject({ status: 400 });
  expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
});
