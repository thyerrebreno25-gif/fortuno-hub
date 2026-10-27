import { expect, it } from "vitest";
import { actionEvent, actionInput, editableMeeting, meetingInput, reminderKey } from "./model";
const input = { title: "Semanal do squad", type: "Semanal", startsAt: "2026-10-26T09:00:00-03:00", endsAt: "2026-10-26T10:00:00-03:00", participantIds: ["a", "a", "b"] };
it("validates meeting intervals and deduplicates participants", () => {
  expect(meetingInput.parse(input).participantIds).toEqual(["a", "b"]);
  expect(meetingInput.safeParse({ ...input, endsAt: input.startsAt }).success).toBe(false);
  expect(meetingInput.safeParse({ ...input, participantIds: [] }).success).toBe(false);
  expect(actionInput.safeParse({ title: "Meta", responsibleId: "a", dueAt: "not a date" }).success).toBe(false);
});
it("moves the agenda commitment to the promised deadline and marks completion", () => {
  const action = { title: "Entregar conciliação", description: "Revisada", dueAt: new Date("2026-10-30T17:00:00-03:00"), completedAt: null };
  expect(actionEvent(action)).toMatchObject({ startsAt: action.dueAt, endsAt: new Date("2026-10-30T20:30:00Z"), status: "ACTIVE" });
  expect(actionEvent({ ...action, completedAt: new Date() }).status).toBe("COMPLETED");
});
it("generates one reminder per Brazilian day and a new reminder after rescheduling", () => {
  const action = { id: "a", dueAt: new Date("2026-10-26T17:00:00Z") };
  const now = new Date("2026-10-27T01:00:00Z");
  expect(reminderKey(action, now)).toBe(reminderKey(action, new Date("2026-10-27T02:59:00Z")));
  expect(reminderKey(action, now)).not.toBe(reminderKey(action, new Date("2026-10-27T03:01:00Z")));
  expect(reminderKey(action, now)).not.toBe(reminderKey({ ...action, dueAt: new Date("2026-10-28") }, now));
});
it("does not grant a team leader editing rights over an unrelated organizer", () => {
  expect(editableMeeting({ userId: "a", role: "OPERATOR", isTeamLeader: true }, { createdById: "b" })).toBe(false);
  expect(editableMeeting({ userId: "a", role: "OPERATOR", isTeamLeader: false }, { createdById: "a" })).toBe(true);
});

it("normalizes guest emails and rejects invalid external addresses", () => {
  expect(meetingInput.parse({ ...input, externalEmails: [" Cliente@Example.com ", "cliente@example.com"] }).externalEmails).toEqual(["cliente@example.com"]);
  expect(meetingInput.safeParse({ ...input, externalEmails: ["email invalido"] }).success).toBe(false);
});
