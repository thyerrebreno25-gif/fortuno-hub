import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  member: { userId: "user-1", organizationId: "org-1", role: "MASTER" },
  findMember: vi.fn(), permissions: vi.fn(), findProject: vi.fn(), projects: vi.fn(), transaction: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: db.user }, error: null }) } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  organizationMember: { findFirst: db.findMember }, roleModulePermission: { findMany: db.permissions },
  onboarding: { findFirst: db.findProject, findMany: db.projects }, $transaction: db.transaction,
} }));
import { onboardingAccessDenied } from "./onboarding-auth";
import type { PermissionShape } from "@/modules/permissions/permissions";
const full: PermissionShape = { canView: true, canCreate: true, canEdit: true, canDelete: true, canManage: true, canImport: true, canExport: true };
const cases = [
  [() => import("@/app/api/onboarding/route"), "GET", "canView"],
  [() => import("@/app/api/onboarding/route"), "POST", "canCreate"],
  [() => import("@/app/api/onboarding/dashboard/route"), "GET", "canView"],
  [() => import("@/app/api/onboarding/projects/route"), "GET", "canView"],
  [() => import("@/app/api/onboarding/projects/route"), "POST", "canCreate"],
  [() => import("@/app/api/onboarding/projects/[id]/route"), "PUT", "canEdit"],
  [() => import("@/app/api/onboarding/projects/[id]/route"), "DELETE", "canDelete"],
  [() => import("@/app/api/onboarding/templates/route"), "GET", "canView"],
  [() => import("@/app/api/onboarding/templates/route"), "POST", "canCreate"],
  [() => import("@/app/api/onboarding/templates/[templateId]/route"), "GET", "canView"],
  [() => import("@/app/api/onboarding/templates/[templateId]/route"), "PUT", "canEdit"],
  [() => import("@/app/api/onboarding/templates/[templateId]/route"), "DELETE", "canDelete"],
  [() => import("@/app/api/onboarding/templates/[templateId]/duplicate/route"), "POST", "canCreate"],
  [() => import("@/app/api/onboarding/templates/seed/route"), "POST", "canManage"],
  [() => import("@/app/api/onboarding/tasks/[taskId]/route"), "PATCH", "canEdit"],
  [() => import("@/app/api/onboarding/tasks/[taskId]/comments/route"), "POST", "canEdit"],
  [() => import("@/app/api/onboarding/tasks/[taskId]/timer/start/route"), "POST", "canEdit"],
  [() => import("@/app/api/onboarding/tasks/[taskId]/timer/stop/route"), "POST", "canEdit"],
] as const;
type Handler = (request: Request, context: { params: Promise<{ id: string; templateId: string; taskId: string }> }) => Promise<Response>;
const context = () => ({ params: Promise.resolve({ id: "project-1", templateId: "template-1", taskId: "task-1" }) });
beforeEach(() => {
  vi.clearAllMocks(); db.user = { id: "user-1" }; db.member.role = "MASTER";
  db.findMember.mockResolvedValue(db.member); db.permissions.mockResolvedValue([]);
});
for (const [index, [load, method, action]] of cases.entries()) {
  it(method + " route " + index + " blocks the operation when its module permission is revoked", async () => {
    db.permissions.mockResolvedValue([{ moduleCode: "ONBOARDING", ...full, [action]: false }]);
    const route = await load();
    const handler = (route as unknown as Record<string, Handler>)[method];
    const response = await handler(new Request("https://hub.test/api/onboarding", { method, ...(method === "GET" ? {} : { body: "{}" }) }), context());
    expect(response.status).toBe(403);
    expect(db.findProject).not.toHaveBeenCalled(); expect(db.projects).not.toHaveBeenCalled(); expect(db.transaction).not.toHaveBeenCalled();
  });
}
it("rejects an unauthenticated session before loading project data", async () => {
  db.user = null;
  const { GET } = await import("@/app/api/onboarding/projects/route");
  expect((await GET()).status).toBe(401); expect(db.findMember).not.toHaveBeenCalled(); expect(db.projects).not.toHaveBeenCalled();
});
it("denies operators by default but honors an explicit organization permission", async () => {
  expect((await onboardingAccessDenied({ organizationId: "org-1", role: "OPERATOR" }))?.status).toBe(403);
  db.permissions.mockResolvedValue([{ moduleCode: "ONBOARDING", ...full }]);
  expect(await onboardingAccessDenied({ organizationId: "org-1", role: "OPERATOR" }, "canEdit")).toBeNull();
  expect(db.permissions).toHaveBeenLastCalledWith({ where: { organizationId: "org-1", role: "OPERATOR" } });
});
it("does not give client profiles internal onboarding access even with an erroneous permission override", async () => {
  db.permissions.mockResolvedValue([{ moduleCode: "ONBOARDING", ...full }]);
  expect((await onboardingAccessDenied({ organizationId: "org-1", role: "CLIENT" }))?.status).toBe(403);
});
it("requires view access even if an edit bit was accidentally left on", async () => {
  db.permissions.mockResolvedValue([{ moduleCode: "ONBOARDING", ...full, canView: false }]);
  expect((await onboardingAccessDenied(db.member, "canEdit"))?.status).toBe(403);
});
it("keeps an authorized update scoped to the current organization and rejects a missing or foreign project", async () => {
  db.findProject.mockResolvedValue(null);
  const { PUT } = await import("@/app/api/onboarding/projects/[id]/route");
  const response = await PUT(new Request("https://hub.test/api/onboarding/projects/project-1", { method: "PUT", body: "{}" }), context());
  expect(response.status).toBe(404);
  expect(db.findProject).toHaveBeenCalledWith({ where: { id: "project-1", organizationId: "org-1" } });
  expect(db.transaction).not.toHaveBeenCalled();
});
