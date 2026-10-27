import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), transaction: vi.fn(),
  activities: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  configurations: { count: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  audit: { findFirst: vi.fn(), create: vi.fn() }, timers: { findMany: vi.fn(), update: vi.fn() }, raw: vi.fn(),
}));
vi.mock("@/modules/operations/auth", () => ({ getOperationMember: m.member, canManageOperations: (role: string) => ["MASTER", "ADMIN", "MANAGER"].includes(role) }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationActivity: m.activities, operationClientProcess: m.configurations, auditLog: m.audit, $transaction: m.transaction } }));
import { GET, POST } from "./route";
const request = (action = "archive") => new Request("https://hub.test/api/operations/reset", { method: "POST", body: JSON.stringify({ action, restoreId: "batch" }) });
beforeEach(() => {
  vi.resetAllMocks(); m.member.mockResolvedValue({ userId: "manager", organizationId: "org", role: "MASTER" });
  m.transaction.mockImplementation(async (run) => run({ operationActivity: m.activities, operationClientProcess: m.configurations, auditLog: m.audit, operationTimeEntry: m.timers, $executeRaw: m.raw }));
  m.activities.findMany.mockResolvedValue([{ id: "task", clientProcessId: "routine" }]); m.configurations.findMany.mockResolvedValue([{ id: "routine" }]); m.timers.findMany.mockResolvedValue([]);
});
it("blocks operators before reading or changing any routine", async () => {
  m.member.mockResolvedValue({ role: "OPERATOR" });
  expect((await GET()).status).toBe(403); expect((await POST(request())).status).toBe(403); expect(m.transaction).not.toHaveBeenCalled();
});
it("archives all pending dates within the organization, deactivates recurrence and records recovery ids", async () => {
  expect((await POST(request())).status).toBe(200);
  const scope = m.activities.findMany.mock.calls[0][0].where;
  expect(scope).toEqual({ organizationId: "org", deletedAt: null, status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } });
  expect(m.configurations.updateMany.mock.calls[0][0]).toMatchObject({ where: { client: { organizationId: "org" } }, data: { active: false } });
  expect(m.audit.create.mock.calls[0][0].data.beforeData).toEqual({ configurations: ["routine"], activities: [{ id: "task", clientProcessId: "routine" }] });
  expect(m.activities.updateMany.mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date);
});
it("pauses active timers while preserving elapsed seconds", async () => {
  m.timers.findMany.mockResolvedValueOnce([{ id: "timer", startedAt: new Date(Date.now() - 60000) }]);
  await POST(request()); expect(m.timers.update.mock.calls[0][0].data.seconds).toBeGreaterThanOrEqual(60);
});
it("rejects restore when the routine has been reused for new work", async () => {
  m.audit.findFirst.mockResolvedValueOnce({ id: "batch", beforeData: { configurations: ["routine"], activities: [] } }).mockResolvedValueOnce(null);
  m.configurations.findMany.mockResolvedValueOnce([{ id: "routine", active: true }]);
  expect((await POST(request("restore"))).status).toBe(409); expect(m.activities.updateMany).not.toHaveBeenCalled();
});
it("rejects unsupported actions without a transaction", async () => {
  expect((await POST(request("delete-everything"))).status).toBe(400); expect(m.transaction).not.toHaveBeenCalled();
});
it("restores the saved activities and recurrences without changing completed history", async () => {
  m.audit.findFirst.mockResolvedValueOnce({ id: "batch", beforeData: { configurations: ["routine"], activities: [{ id: "task", clientProcessId: "routine" }] } }).mockResolvedValueOnce(null);
  m.configurations.findMany.mockResolvedValueOnce([{ id: "routine", active: false }]);
  m.activities.updateMany.mockResolvedValueOnce({ count: 1 });
  expect((await POST(request("restore"))).status).toBe(200);
  expect(m.activities.updateMany.mock.calls[0][0]).toMatchObject({ where: { organizationId: "org", id: "task", deletionReason: "Limpeza de rotinas: batch" }, data: { deletedAt: null, clientProcessId: "routine" } });
  expect(m.configurations.updateMany.mock.calls[0][0].data).toEqual({ active: true });
});
