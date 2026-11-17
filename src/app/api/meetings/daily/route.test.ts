import {beforeEach, expect, it, vi} from "vitest";
const m = vi.hoisted(() => ({access: vi.fn(), find: vi.fn(), actions: vi.fn(), count: vi.fn(), process: vi.fn(), save: vi.fn()}));
vi.mock("@/lib/prisma", () => ({prisma: {meetingActionItem: {findMany: m.actions, count: m.count}}}));
vi.mock("@/modules/meetings/auth", () => ({meetingAccess: m.access, findMeeting: m.find, meetingFailure: (error: Error & {status?: number}) => Response.json({error: error.message}, {status: error.status || 400}), MeetingError: class extends Error {constructor(message: string, public status = 400) {super(message);}}}));
vi.mock("@/modules/meetings/daily-server", () => ({processDailyActivities: m.process}));
vi.mock("@/modules/meetings/service", () => ({saveAction: m.save}));
vi.mock("@/modules/meetings/delivery", () => ({processMeetingBackground: vi.fn()}));
vi.mock("next/server", async () => ({...await vi.importActual("next/server"), after: vi.fn()}));
import {GET, PATCH} from "./route";
const member = {userId: "me", organizationId: "tenant", role: "OPERATOR"};
beforeEach(() => {
  vi.clearAllMocks(); m.access.mockResolvedValue({member, permissions: {canView: true, canEdit: true}, modulePermissions: {MEETINGS: {canView: false}}});
  m.actions.mockResolvedValue([]); m.count.mockResolvedValue(0); m.find.mockResolvedValue({type: "Daily"});
  m.save.mockResolvedValue({id: "task", completedAt: new Date(), revision: 3});
});
it("uses independent Daily permissions, keeps operators in their own scope and hides inaccessible meeting links", async () => {
  const result = await GET(new Request("https://hub.test/api/meetings/daily?scope=all")); const body = await result.json();
  expect(result.status).toBe(200); expect(m.access).toHaveBeenCalledWith("DAILY_ACTIVITIES");
  expect(m.actions.mock.calls[0][0].where).toMatchObject({responsibleId: "me", meeting: {organizationId: "tenant"}});
  expect(body).toMatchObject({canViewMeetings: false, canEdit: true});
});
it("completes the shared action without granting access to the meeting module", async () => {
  const body = {meetingId: "meeting", id: "task", revision: 2, completed: true};
  const result = await PATCH(new Request("https://hub.test/api/meetings/daily", {method: "PATCH", body: JSON.stringify(body)}));
  expect(result.status).toBe(200); expect(m.access).toHaveBeenCalledWith("DAILY_ACTIVITIES", "canEdit");
  expect(m.save).toHaveBeenCalledWith(member, "meeting", body, "task");
});
it("denies a revoked profile before reading or writing data", async () => {
  m.access.mockRejectedValue(Object.assign(new Error("Seu perfil não permite esta ação."), {status: 403}));
  expect((await GET(new Request("https://hub.test/api/meetings/daily"))).status).toBe(403);
  expect(m.actions).not.toHaveBeenCalled(); expect(m.process).not.toHaveBeenCalled();
});
it("does not turn Daily permission into access to other meeting types or task assignment", async () => {
  m.find.mockResolvedValue({type: "Planejamento"});
  const request = (extra = {}) => new Request("https://hub.test/api/meetings/daily", {method: "PATCH", body: JSON.stringify({meetingId: "m", id: "t", revision: 1, completed: true, ...extra})});
  expect((await PATCH(request())).status).toBe(403);
  expect((await PATCH(request({responsibleId: "other"}))).status).toBe(400);
  expect(m.save).not.toHaveBeenCalled();
});
