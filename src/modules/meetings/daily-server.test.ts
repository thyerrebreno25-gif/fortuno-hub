import {beforeEach, expect, it, vi} from "vitest";
const m = vi.hoisted(() => ({candidates: vi.fn(), tx: {$queryRaw: vi.fn(), meetingActionItem: {findUnique: vi.fn(), update: vi.fn()}, operationHoliday: {findMany: vi.fn()}, organizationMember: {findMany: vi.fn()}, notice: {create: vi.fn()}, teamCalendarEvent: {upsert: vi.fn()}, meetingDelivery: {updateMany: vi.fn(), createMany: vi.fn()}}}));
vi.mock("@/lib/prisma", () => ({prisma: {meetingActionItem: {findMany: m.candidates}, $transaction: (callback: (tx: typeof m.tx) => unknown) => callback(m.tx)}}));
import {processDailyActivities} from "./daily-server";
const now = new Date("2026-11-20T13:00:00Z");
const original = {id: "action", meetingId: "meeting", responsibleId: "operator", title: "Entregar fechamento", dueAt: new Date("2026-11-20T12:30:00Z"), originalDueAt: null, autoExtendedAt: null, overdueNoticeId: null, completedAt: null, responsible: {name: "Operador", email: "o@example.test"}, meeting: {id: "meeting", organizationId: "org", type: "Daily", title: "Daily do squad", responsibleId: "manager", createdById: "manager", deletedAt: null, status: "COMPLETED"}};
beforeEach(() => {
  vi.clearAllMocks(); m.candidates.mockResolvedValue([{id: "action", meetingId: "meeting"}]); m.tx.meetingActionItem.findUnique.mockResolvedValue({...original});
  m.tx.operationHoliday.findMany.mockResolvedValue([{date: new Date("2026-11-23T00:00:00Z")}]);
  m.tx.organizationMember.findMany.mockResolvedValue([{id: "op-member", userId: "operator", role: "OPERATOR", teamLeaderId: "manager-member"}, {id: "manager-member", userId: "manager", role: "MANAGER"}]);
  m.tx.notice.create.mockResolvedValue({id: "notice"});
});
it("extends only Daily once, updates its shared calendar record and creates a real manager Aviso", async () => {
  await processDailyActivities("org", now);
  expect(m.tx.meetingActionItem.update).toHaveBeenCalledWith({where: {id: "action"}, data: {originalDueAt: original.dueAt, autoExtendedAt: now, dueAt: new Date("2026-11-24T12:30:00Z"), revision: {increment: 1}}});
  expect(m.tx.teamCalendarEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({update: expect.objectContaining({startsAt: new Date("2026-11-24T12:30:00Z"), googleSyncStatus: "PENDING"})}));
  expect(m.tx.notice.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({organizationId: "org", kind: "ALERT", recipients: {create: [{memberId: "manager-member"}]}})}));
  expect(m.tx.meetingActionItem.update).toHaveBeenCalledWith({where: {id: "action"}, data: {overdueNoticeId: "notice"}});
});
it("does not extend again or duplicate the manager notice on a retry or second missed deadline", async () => {
  m.tx.meetingActionItem.findUnique.mockResolvedValue({...original, originalDueAt: original.dueAt, autoExtendedAt: now, overdueNoticeId: "notice"});
  await processDailyActivities("org", new Date("2026-11-25T15:00:00Z"));
  expect(m.tx.meetingActionItem.update).not.toHaveBeenCalled(); expect(m.tx.notice.create).not.toHaveBeenCalled();
});
it("alerts weekly squad deadlines without postponing them", async () => {
  m.tx.meetingActionItem.findUnique.mockResolvedValue({...original, meeting: {...original.meeting, type: "Semanal de squad"}});
  await processDailyActivities("org", now);
  expect(m.tx.teamCalendarEvent.upsert).not.toHaveBeenCalled(); expect(m.tx.notice.create).toHaveBeenCalledOnce();
});
it.each(["completed", "cancelled", "deleted"])("ignores a %s action that changed while the worker was waiting for the lock", async kind => {
  m.tx.meetingActionItem.findUnique.mockResolvedValue({...original, ...(kind === "completed" ? {completedAt: now} : {}), meeting: {...original.meeting, ...(kind === "cancelled" ? {status: "CANCELLED"} : kind === "deleted" ? {deletedAt: now} : {})}});
  await processDailyActivities("org", now); expect(m.tx.meetingActionItem.update).not.toHaveBeenCalled(); expect(m.tx.notice.create).not.toHaveBeenCalled();
});
