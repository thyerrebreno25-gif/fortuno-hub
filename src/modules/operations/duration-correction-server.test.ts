import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ activity: vi.fn(), pauseState:vi.fn(), entries: vi.fn(), update: vi.fn(), create: vi.fn(), previous: vi.fn(), event: vi.fn(), person: vi.fn(), lock: vi.fn(), row: vi.fn(), transaction: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { correctActivityDuration } from "./duration-correction-server";
const now = new Date("2026-11-17T18:00:00Z"), version = "2026-11-17T15:00:00.000Z";
const member = { userId: "u", organizationId: "org", role: "OPERATOR", canEdit: true, user: { name: "Pessoa", email: "u@test" } } as never;
const old = { id: "one", activityId: "a", userId: "u", startedAt: new Date("2026-11-16T12:00:00Z"), endedAt: new Date("2026-11-16T13:00:00Z"), seconds: 3600, source: "TIMER", description: null, updatedAt: new Date(version) };
const input = { mode: "duration" as const, requestId: "22c6f4cc-3cc8-479d-a5fb-24f9a05c7340", userId: "u", seconds: 2700, reason: "Esqueci de pausar", expectedEntries: [{ id: "one", updatedAt: version }] };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  m.transaction.mockImplementation(async run => run({ $executeRaw: m.lock, $queryRaw: m.row, operationActivity: { findFirst: m.activity,updateMany:m.pauseState }, operationTimeEntry: { findMany: m.entries, update: m.update, create: m.create }, organizationMember: { findFirst: m.person }, operationEvent: { findFirst: m.previous, create: m.event } }));
  m.activity.mockResolvedValue({ id: "a", responsibleId: "u", status: "COMPLETED", scheduledDate: new Date("2026-11-16T00:00:00Z"), completedAt: now });
  m.entries.mockResolvedValue([old]); m.previous.mockResolvedValue(null); m.person.mockResolvedValue({ user: { name: "Pessoa", email: "u@test" } }); m.create.mockResolvedValue({ id: input.requestId });
});
afterEach(() => vi.useRealTimers());
it("replaces the total across multiple sessions, preserving their dates and never adding the correction on top", async () => {
  m.entries.mockResolvedValue([old, { ...old, id: "two", seconds: 1800, startedAt: new Date("2026-11-17T12:00:00Z"), endedAt: new Date("2026-11-17T12:30:00Z") }]);
  expect(await correctActivityDuration(member, "a", { ...input, expectedEntries: [...input.expectedEntries, { id: "two", updatedAt: version }] })).toEqual({ seconds: 2700 });
  expect(m.update.mock.calls.map(call => call[0].data.seconds)).toEqual([1800, 900]);
  expect(m.update.mock.calls.every(call => call[0].data.startedAt === undefined)).toBe(true);
  expect(m.create).not.toHaveBeenCalled();
  expect(m.event.mock.calls[0][0].data).toMatchObject({ userId: "u", type: "TIME_ADJUSTED", metadata: { previousSeconds: 5400, totalSeconds: 2700, before: [{ id: "one", seconds: 3600 }, { id: "two", seconds: 1800 }] } });
  expect(m.activity.mock.calls[0][0].where).toMatchObject({ organizationId: "org", deletedAt: null });
});
it("closes a forgotten running timer and uses the supplied total, with its elapsed time in the audit", async () => {
  m.entries.mockResolvedValue([{ ...old, startedAt: new Date("2026-11-17T12:00:00Z"), endedAt: null, seconds: 0 }]);
  await correctActivityDuration(member, "a", { ...input, seconds: 9480 });
  expect(m.lock.mock.calls[0][1]).toBe("operation-timer:u");
  expect(m.update.mock.calls[0][0]).toMatchObject({ where: { id: "one" }, data: { endedAt: now, seconds: 9480, source: "CORRECTED_DURATION" } });
  expect(m.event.mock.calls[0][0].data.metadata.previousSeconds).toBe(21600);
});
it("records missing time on the activity date without requiring or inventing an elapsed interval", async () => {
  m.entries.mockResolvedValue([]);
  await correctActivityDuration(member, "a", { ...input, expectedEntries: [] });
  const saved = m.create.mock.calls[0][0].data;
  expect(saved).toMatchObject({ userId: "u", activityId: "a", seconds: 2700, source: "MANUAL_DURATION" });
  expect(saved.startedAt.toISOString()).toBe("2026-11-16T15:00:00.000Z");
  expect(saved.endedAt).toEqual(saved.startedAt);
});
it("does not apply a correction twice after a retry", async () => {
  m.previous.mockResolvedValue({ userId: "u", metadata: { entryUserId: "u", totalSeconds: 2700, reason: input.reason } });
  expect(await correctActivityDuration(member, "a", input)).toEqual({ seconds: 2700 });
  expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.event).not.toHaveBeenCalled();
});
it("rejects a stale snapshot, including a timer added or paused while the form was open", async () => {
  for (const entries of [[{ ...old, updatedAt: now }], [old, { ...old, id: "new" }], []]) {
    m.entries.mockResolvedValue(entries);
    await expect(correctActivityDuration(member, "a", input)).rejects.toMatchObject({ status: 409 });
  }
  expect(m.update).not.toHaveBeenCalled();
});
it("denies edits without permission, another operator's time, and deleted/foreign activities", async () => {
  await expect(correctActivityDuration({ ...member as object, canEdit: false } as never, "a", input)).rejects.toMatchObject({ status: 403 });
  await expect(correctActivityDuration(member, "a", { ...input, userId: "other" })).rejects.toMatchObject({ status: 403 });
  expect(m.transaction).not.toHaveBeenCalled();
  m.activity.mockResolvedValue(null); await expect(correctActivityDuration(member, "a", input)).rejects.toMatchObject({ status: 404 });
});
it("permits management to correct the responsible person's total while keeping the editor and author separate", async () => {
  await correctActivityDuration({ ...member as object, userId: "manager", role: "MANAGER" } as never, "a", input);
  expect(m.entries.mock.calls[0][0].where).toEqual({ activityId: "a", userId: "u" });
  expect(m.event.mock.calls[0][0].data).toMatchObject({ userId: "manager", metadata: { entryUserId: "u" } });
});
it("allows an erroneous total to be reset to zero while preserving its audit", async () => {
  await correctActivityDuration(member, "a", { ...input, seconds: 0 });
  expect(m.update.mock.calls[0][0].data.seconds).toBe(0);
  expect(m.event.mock.calls[0][0].data.metadata).toMatchObject({ previousSeconds: 3600, totalSeconds: 0 });
});
