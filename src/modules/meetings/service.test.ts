import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  tx: { $queryRaw: vi.fn(), teamMeeting: { findUniqueOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() }, meetingActionItem: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() }, meetingParticipant: { deleteMany: vi.fn(), createMany: vi.fn() }, teamCalendarEvent: { updateMany: vi.fn(), upsert: vi.fn() }, meetingDelivery: { updateMany: vi.fn(), createMany: vi.fn(), create: vi.fn() } }, members: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { organizationMember: { count: mocks.members }, $transaction: (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) } }));
vi.mock("./auth", () => ({ findMeeting: mocks.find, MeetingError: class extends Error { constructor(message: string, public status = 400) { super(message); } } }));
import { saveAction, saveMeeting } from "./service";
const member = { id: "member", userId: "a", organizationId: "org", role: "OPERATOR" as const, isTeamLeader: false, teamLeaderId: null, user: { id: "a", name: "A", email: "a@example.com" } };
const meeting = { id: "m", organizationId: "org", createdById: "a", title: "Semanal", type: "Semanal", startsAt: new Date("2026-10-26T12:00:00Z"), endsAt: new Date("2026-10-26T13:00:00Z"), agenda: "", location: "", status: "SCHEDULED", revision: 1, participants: [{ userId: "a" }, { userId: "b" }] };
const action = { id: "task", meetingId: "m", title: "Entregar relatório", description: "", responsibleId: "b", dueAt: new Date("2026-10-30T20:00:00Z"), completedAt: null, revision: 1 };
beforeEach(() => {
  vi.clearAllMocks(); mocks.find.mockResolvedValue(meeting); mocks.members.mockResolvedValue(2);
  mocks.tx.teamMeeting.create.mockResolvedValue(meeting); mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue(meeting); mocks.tx.teamMeeting.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.meetingActionItem.count.mockResolvedValue(0); mocks.tx.meetingActionItem.findFirst.mockResolvedValue(action); mocks.tx.meetingActionItem.create.mockResolvedValue(action); mocks.tx.meetingActionItem.updateMany.mockResolvedValue({ count: 1 }); mocks.tx.meetingActionItem.findUniqueOrThrow.mockResolvedValue(action); mocks.tx.meetingActionItem.findMany.mockResolvedValue([]);
});
it("creates individual calendar events for participants and queues invitations", async () => {
  await saveMeeting(member, { ...meeting, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), participantIds: ["a", "b"] });
  expect(mocks.tx.teamCalendarEvent.upsert).toHaveBeenCalledTimes(2);
  expect(mocks.tx.teamCalendarEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ organizationId: "org", userId: "b", sourceKey: "meeting:m" }) }));
  expect(mocks.tx.meetingDelivery.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ userId: "b", meetingId: "m" })]) }));
});
it("rejects participants outside the organization before saving", async () => {
  mocks.members.mockResolvedValue(1);
  await expect(saveMeeting(member, { ...meeting, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), participantIds: ["a", "outside"] })).rejects.toThrow("organização");
  expect(mocks.tx.teamMeeting.create).not.toHaveBeenCalled();
});
it("transfers a delivery by cancelling the old owner's event", async () => {
  await saveAction(member, "m", { title: action.title, responsibleId: "b", dueAt: action.dueAt.toISOString() });
  expect(mocks.tx.teamCalendarEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actionItemId: "task", userId: { not: "b" } }, data: expect.objectContaining({ status: "CANCELLED" }) }));
  expect(mocks.tx.teamCalendarEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ userId: "b", actionItemId: "task", startsAt: action.dueAt }) }));
});
it("marks a checked delivery completed in the agenda and stops reminder emails", async () => {
  mocks.tx.meetingActionItem.findUniqueOrThrow.mockResolvedValue({ ...action, completedAt: new Date(), revision: 2 });
  await saveAction(member, "m", { completed: true, revision: 1 }, "task");
  expect(mocks.tx.teamCalendarEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "COMPLETED" }) }));
  expect(mocks.tx.meetingDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actionItemId: "task", emailStatus: "PENDING" } }));
  expect(mocks.tx.meetingDelivery.create).not.toHaveBeenCalled();
});
it("prevents a collaborator from checking somebody else's goal", async () => {
  mocks.find.mockResolvedValue({ ...meeting, createdById: "other" }); mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({ ...meeting, createdById: "other" });
  await expect(saveAction(member, "m", { completed: true, revision: 1 }, "task")).rejects.toThrow("responsável");
  expect(mocks.tx.teamCalendarEvent.upsert).not.toHaveBeenCalled();
});
it("rejects stale checklist revisions without changing the agenda", async () => {
  mocks.tx.meetingActionItem.updateMany.mockResolvedValue({ count: 0 });
  await expect(saveAction(member, "m", { completed: true, revision: 1 }, "task")).rejects.toThrow("alterada");
  expect(mocks.tx.teamCalendarEvent.upsert).not.toHaveBeenCalled();
});
it("cancels the meeting's linked events", async () => {
  mocks.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({ ...meeting, status: "CANCELLED", revision: 2 });
  await saveMeeting(member, { ...meeting, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), participantIds: ["a", "b"], status: "CANCELLED", revision: 1 }, "m");
  expect(mocks.tx.teamCalendarEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { meetingId: "m" }, data: expect.objectContaining({ status: "CANCELLED" }) }));
});
