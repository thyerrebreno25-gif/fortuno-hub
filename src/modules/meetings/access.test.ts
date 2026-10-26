import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), meeting: vi.fn(), recording: vi.fn(), storage: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { teamMeeting: { findFirst: mocks.meeting }, meetingRecording: { findUnique: mocks.recording } } }));
vi.mock("@/modules/notices/server/notice-auth", () => ({ getNoticeMember: mocks.member }));
vi.mock("@/modules/permissions/permissions", () => ({ getRolePermissions: mocks.permissions }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.storage }));
import { findMeeting, meetingAccess, meetingScope } from "./auth";
import { GET as audio } from "@/app/api/meetings/recordings/route";
import { GET as cron } from "@/app/api/cron/meeting-reminders/route";
const member = { id: "m", userId: "a", organizationId: "org", role: "OPERATOR" as const, isTeamLeader: false, teamLeaderId: null, user: { id: "a", name: "A", email: "a@example.com" } };
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
it("restricts ordinary collaborators to meetings they created or participate in", () => {
  expect(meetingScope(member)).toEqual({ organizationId: "org", OR: [{ createdById: "a" }, { participants: { some: { userId: "a" } } }] });
  expect(meetingScope({ ...member, role: "ADMIN" })).toEqual({ organizationId: "org" });
});
it("returns no meeting or audio for another organization or inaccessible meeting", async () => {
  mocks.member.mockResolvedValue(member); mocks.permissions.mockResolvedValue({ MEETINGS: { canView: true } }); mocks.meeting.mockResolvedValue(null);
  mocks.recording.mockResolvedValue({ id: "r", meetingId: "foreign", status: "DONE" });
  await expect(findMeeting(member, "foreign")).rejects.toThrow("não encontrada");
  const result = await audio(new Request("https://example.test/api/meetings/recordings?id=r"));
  expect(result.status).toBe(404); expect(mocks.storage).not.toHaveBeenCalled();
});
it("requires view permission and excludes client accounts", async () => {
  mocks.member.mockResolvedValue(member); mocks.permissions.mockResolvedValue({ MEETINGS: { canView: false } });
  await expect(meetingAccess()).rejects.toThrow("perfil");
  mocks.member.mockResolvedValue({ ...member, role: "CLIENT" }); mocks.permissions.mockResolvedValue({ MEETINGS: { canView: true } });
  await expect(meetingAccess()).rejects.toThrow("perfil");
});
it("does not authenticate the cron by a forgeable User-Agent", async () => {
  vi.stubEnv("CRON_SECRET", "");
  const result = await cron(new Request("https://example.test/api/cron/meeting-reminders", { headers: { "user-agent": "vercel-cron/1.0" } }));
  expect(result.status).toBe(401);
});
