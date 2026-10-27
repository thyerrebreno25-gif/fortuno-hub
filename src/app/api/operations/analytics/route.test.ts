import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ member: vi.fn(), activities: vi.fn(), entries: vi.fn(), clients: vi.fn(), members: vi.fn(), processes: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ getOperationMember: mocks.member }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationActivity: { findMany: mocks.activities }, operationTimeEntry: { findMany: mocks.entries }, client: { findMany: mocks.clients }, organizationMember: { findMany: mocks.members }, operationProcess: { findMany: mocks.processes } } }));
import { GET } from "./route";
const request = (query = "") => new Request(`https://hub.test/api/operations/analytics?from=2026-10-01&to=2026-10-27${query}`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.member.mockResolvedValue({ userId: "u", organizationId: "org", role: "MASTER" });
  mocks.activities.mockResolvedValue([]); mocks.entries.mockResolvedValue([]); mocks.clients.mockResolvedValue([]); mocks.members.mockResolvedValue([]); mocks.processes.mockResolvedValue([]);
});
it("requires an authorized operations session", async () => {
  mocks.member.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(403); expect(mocks.entries).not.toHaveBeenCalled();
});
it("rejects invalid dates before querying activity and time records", async () => {
  expect((await GET(new Request("https://hub.test/api/operations/analytics?from=2026-02-30&to=2026-03-01"))).status).toBe(400);
  expect(mocks.activities).not.toHaveBeenCalled();
});
it("scopes both workload and time to the organization, excludes deleted records and keeps filter semantics", async () => {
  const response = await GET(request("&clientId=c&processId=p&team=Equipe+A&cluster=B&operatorId=person"));
  expect(response.status).toBe(200);
  expect(mocks.activities.mock.calls[0][0].where).toMatchObject({ organizationId: "org", deletedAt: null, clientId: "c", processId: "p", team: "Equipe A", clientCluster: "B", responsibleId: "person" });
  expect(mocks.entries.mock.calls[0][0].where).toMatchObject({ userId: "person", activity: { organizationId: "org", deletedAt: null, clientId: "c" } });
  expect(mocks.entries.mock.calls[0][0].where.startedAt.lt.toISOString()).toBe("2026-10-28T03:00:00.000Z");
});
it("restricts operators to their authored time and prevents selecting another operator", async () => {
  mocks.member.mockResolvedValue({ userId: "u", organizationId: "org", role: "OPERATOR" });
  expect((await GET(request("&operatorId=other"))).status).toBe(403);
  expect(mocks.entries).not.toHaveBeenCalled();
  const response = await GET(request()); expect(response.status).toBe(200);
  expect((await response.json()).ownOnly).toBe(true);
  expect(mocks.activities.mock.calls[0][0].where.responsibleId).toBe("u");
  expect(mocks.entries.mock.calls[0][0].where.userId).toBe("u");
  expect(mocks.members.mock.calls[0][0].where.userId).toBe("u");
});
it("returns an explicit error rather than incomplete totals for oversized periods", async () => {
  mocks.activities.mockResolvedValueOnce(Array(20001).fill({}));
  expect((await GET(request())).status).toBe(422);
});
it("does not leak database errors and reports empty periods explicitly", async () => {
  mocks.entries.mockRejectedValueOnce(new Error("PRIVATE_DATABASE_DETAIL"));
  const response = await GET(request()); expect(response.status).toBe(500); expect(await response.text()).not.toContain("PRIVATE_DATABASE_DETAIL");
  mocks.entries.mockResolvedValue([]);
  const payload = await (await GET(request())).json();
  expect(payload.summary).toMatchObject({ seconds: 0, worked: 0, planned: 0, coverage: null });
  expect(payload.daily).toHaveLength(27);
});
