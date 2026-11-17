import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ member: vi.fn(), find: vi.fn(), remove: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ getOperationMember: m.member, canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationActivity: { findMany: m.find } } }));
vi.mock("@/modules/operations/bulk-delete-server", async importOriginal => {
  const original = await importOriginal<typeof import("@/modules/operations/bulk-delete-server")>();
  return { ...original, deleteActivitiesForDay: m.remove };
});
import { GET, POST } from "./route";
const request = () => new Request("https://hub.test/api/operations/activities/bulk-delete?day=2026-11-17");
const body = { day: "2026-11-17", reason: "Atividades duplicadas", activities: [{ id: "a", updatedAt: "2026-11-17T12:00:00.000Z" }] };
const post = (value: unknown = body) => new Request(request().url, { method: "POST", body: JSON.stringify(value) });
beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ userId: "m", organizationId: "org", role: "MASTER", canEdit: true }); m.find.mockResolvedValue([]); m.remove.mockResolvedValue({ deleted: 1, day: body.day }); });
it("previews the full day independently of the current task filters and without performing a deletion", async () => {
  const response = await GET(request()); expect(response.status).toBe(200);
  expect(m.find.mock.calls[0][0].where).toEqual({ organizationId: "org", deletedAt: null, scheduledDate: { gte: new Date("2026-11-17T00:00:00Z"), lt: new Date("2026-11-18T00:00:00Z") } });
  expect(m.remove).not.toHaveBeenCalled();
});
it("requires an authorized editing manager for both preview and deletion", async () => {
  m.member.mockResolvedValueOnce(null); expect((await GET(request())).status).toBe(401);
  m.member.mockResolvedValue({ role: "OPERATOR", organizationId: "org" }); expect((await GET(request())).status).toBe(403); expect((await POST(post())).status).toBe(403);
  m.member.mockResolvedValue({ role: "ADMIN", organizationId: "org", canEdit: false }); expect((await POST(post())).status).toBe(403);
  expect(m.remove).not.toHaveBeenCalled(); expect(m.find).not.toHaveBeenCalled();
});
it("rejects an invalid date, missing justification, empty selection and duplicate IDs", async () => {
  expect((await GET(new Request(request().url.replace("2026-11-17", "2026-02-30")))).status).toBe(400);
  for (const value of [{ ...body, reason: " " }, { ...body, activities: [] }, { ...body, activities: [...body.activities, ...body.activities] }]) expect((await POST(post(value))).status).toBe(400);
  expect(m.remove).not.toHaveBeenCalled();
});
it("passes only the reviewed selection to the service and never silently truncates large day previews", async () => {
  expect(await (await POST(post())).json()).toEqual({ deleted: 1, day: body.day }); expect(m.remove.mock.calls[0][1]).toEqual(body);
  m.find.mockResolvedValue(Array(2001).fill({ id: "row" })); expect((await GET(request())).status).toBe(422);
});
