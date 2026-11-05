import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ member: vi.fn(), permissions: vi.fn(), snapshot: vi.fn(), cache: vi.fn() }));
vi.mock("@/modules/permissions/permissions", () => ({ getCurrentMember: mocks.member, getRolePermissions: mocks.permissions }));
vi.mock("@/modules/executive/server", () => ({ executiveSnapshot: mocks.snapshot }));
vi.mock("next/cache", () => ({ unstable_cache: mocks.cache }));
import { GET } from "./route";

const moduleCodes = ["MANAGEMENT", "CLIENTS", "WHATSAPP", "SERVICE_CENTER", "SUPPORT", "OPERATIONS", "MEETINGS", "CALENDAR", "IMPORTS", "PURCHASE_INVOICES", "INVESTMENT_INCOME", "CONTRACT_IMPORTS"];
const permissions = (disabled: string[] = []) => Object.fromEntries(moduleCodes.map(code => [code, { canView: !disabled.includes(code) }]));
const request = (period = "today") => new Request("https://hub.test/api/executive?period=" + period);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  mocks.member.mockResolvedValue({ organizationId: "org-a", userId: "manager-a", role: "MANAGER" });
  mocks.permissions.mockResolvedValue(permissions());
  mocks.snapshot.mockResolvedValue({ generatedAt: "2026-11-05T12:00:00Z", marker: "safe-summary" });
  mocks.cache.mockImplementation((callback: () => Promise<unknown>) => callback);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("rejects unauthenticated requests before reading permissions or data", async () => {
  mocks.member.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  expect(mocks.permissions).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
});
it("rejects operators even when module permission is configured as allowed", async () => {
  mocks.member.mockResolvedValue({ organizationId: "org-a", userId: "operator", role: "OPERATOR" });
  expect((await GET(request())).status).toBe(403);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
});
it("requires management module access even for a manager", async () => {
  mocks.permissions.mockResolvedValue(permissions(["MANAGEMENT"]));
  expect((await GET(request())).status).toBe(403);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("rejects invalid periods before creating or loading a snapshot", async () => {
  expect((await GET(request("all-time"))).status).toBe(400);
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
});
it("passes organization and each effective module permission to the snapshot", async () => {
  mocks.permissions.mockResolvedValue(permissions(["INVESTMENT_INCOME", "CONTRACT_IMPORTS", "WHATSAPP"]));
  const response = await GET(request("month"));
  expect(response.status).toBe(200);
  expect(mocks.permissions).toHaveBeenCalledWith("org-a", "MANAGER");
  expect(mocks.snapshot).toHaveBeenCalledWith("org-a", "month", {
    clients: true, whatsapp: false, email: true, support: true, operations: true, meetings: true, calendar: true,
    finance: true, purchase: true, investment: false, contract: false, ca: true,
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("marks Conta Azul unavailable when every export module is denied", async () => {
  mocks.permissions.mockResolvedValue(permissions(["IMPORTS", "PURCHASE_INVOICES", "INVESTMENT_INCOME", "CONTRACT_IMPORTS"]));
  expect((await GET(request())).status).toBe(200);
  expect(mocks.snapshot.mock.calls[0][2].ca).toBe(false);
});
it("partitions the server cache by organization, period, São Paulo date and effective permissions", async () => {
  await GET(request("week"));
  const first = mocks.cache.mock.calls[0];
  expect(first[1]).toEqual(["executive-v1", "org-a", "week", "2026-11-05", expect.any(String)]);
  expect(first[2]).toEqual({ revalidate: 60 });
  expect(JSON.parse(first[1][4]).contract).toBe(true);

  mocks.member.mockResolvedValue({ organizationId: "org-b", userId: "manager-b", role: "MANAGER" });
  mocks.permissions.mockResolvedValue(permissions(["CONTRACT_IMPORTS", "INVESTMENT_INCOME"]));
  await GET(request("week"));
  const second = mocks.cache.mock.calls[1][1];
  expect(second[1]).toBe("org-b");
  expect(JSON.parse(second[4])).toMatchObject({ contract: false, investment: false });
  expect(second).not.toEqual(first[1]);

  mocks.permissions.mockResolvedValue(permissions());
  await GET(request("week"));
  expect(mocks.cache.mock.calls[2][1]).not.toEqual(second);
});
it("uses the São Paulo calendar date in cache keys across a UTC day boundary", async () => {
  vi.setSystemTime(new Date("2026-11-05T02:59:59Z"));
  await GET(request());
  expect(mocks.cache.mock.calls[0][1][3]).toBe("2026-11-04");
});
it("returns a generic unavailable response when snapshot queries fail", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.snapshot.mockRejectedValue(new Error("private-db-password-and-connection-detail"));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).toBe(JSON.stringify({ error: "Não foi possível atualizar o painel gerencial." }));
});
