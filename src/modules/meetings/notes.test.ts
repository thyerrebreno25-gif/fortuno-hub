import {beforeEach, expect, it, vi} from "vitest";
const m = vi.hoisted(() => ({access: vi.fn(), find: vi.fn(), tx: {$queryRaw: vi.fn(), teamMeeting: {findUniqueOrThrow: vi.fn()}, meetingNote: {findFirst: vi.fn(), update: vi.fn(), delete: vi.fn()}, auditLog: {create: vi.fn()}}}));
vi.mock("@/lib/prisma", () => ({prisma: {$transaction: (callback: (tx: typeof m.tx) => unknown) => callback(m.tx)}}));
vi.mock("./auth", () => ({meetingAccess: m.access, findMeeting: m.find, meetingFailure: (error: Error & {status?: number}) => Response.json({error: error.message}, {status: error.status || 400}), MeetingError: class extends Error {constructor(message: string, public status = 400) {super(message);}}}));
import {PATCH, DELETE} from "@/app/api/meetings/notes/route";
const request = (body: object) => new Request("https://hub.test/api/meetings/notes", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({meetingId: "meeting", id: "note", ...body})});
beforeEach(() => {
  vi.clearAllMocks(); m.access.mockResolvedValue({member: {userId: "me", organizationId: "org", role: "OPERATOR", isTeamLeader: false}});
  m.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({createdById: "organizer", responsibleId: "manager", deletedAt: null, status: "SCHEDULED", participants: [{userId: "me"}]});
  m.tx.meetingNote.findFirst.mockResolvedValue({id: "note", meetingId: "meeting", authorId: "me", body: "original", revision: 2, reactions: {other: "❤️"}});
  m.tx.meetingNote.update.mockResolvedValue({id: "note"});
});
it("edits an author's current revision without replacing other participants' reactions", async () => {
  const response = await PATCH(request({revision: 2, body: "Revisada"})); expect(response.status).toBe(200);
  expect(m.tx.meetingNote.update).toHaveBeenCalledWith({where: {id: "note"}, data: {body: "Revisada", editedAt: expect.any(Date), revision: {increment: 1}}});
});
it("rejects stale edits and non-author edits, including a manager", async () => {
  expect((await PATCH(request({revision: 1, body: "stale"}))).status).toBe(409);
  m.access.mockResolvedValue({member: {userId: "manager", organizationId: "org", role: "MANAGER", isTeamLeader: false}});
  expect((await PATCH(request({revision: 2, body: "other"}))).status).toBe(403);
  expect(m.tx.meetingNote.update).not.toHaveBeenCalled();
});
it("lets the meeting's responsible person delete a note but denies an unrelated participant", async () => {
  m.tx.meetingNote.findFirst.mockResolvedValue({id: "note", authorId: "other", revision: 2});
  expect((await DELETE(request({revision: 2}))).status).toBe(403);
  m.access.mockResolvedValue({member: {userId: "manager", organizationId: "org", role: "OPERATOR", isTeamLeader: false}});
  expect((await DELETE(request({revision: 2}))).status).toBe(200);
  expect(m.tx.meetingNote.delete).toHaveBeenCalledOnce();
});
it("serializes reactions, retaining others' reactions and the text revision", async () => {
  expect((await PATCH(request({action: "react", emoji: "✅"}))).status).toBe(200);
  expect(m.tx.meetingNote.update).toHaveBeenCalledWith({where: {id: "note"}, data: {reactions: {other: "❤️", me: "✅"}}});
});
it("rechecks cancelled meetings and removed participants under the lock", async () => {
  m.tx.teamMeeting.findUniqueOrThrow.mockResolvedValue({createdById: "organizer", responsibleId: "manager", deletedAt: null, status: "SCHEDULED", participants: []});
  expect((await PATCH(request({action: "react", emoji: "✅"}))).status).toBe(403);
  expect(m.tx.meetingNote.update).not.toHaveBeenCalled();
});
