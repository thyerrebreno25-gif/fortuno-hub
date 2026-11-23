import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), count: vi.fn(), groups: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ getOperationMember: m.member }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationActivity: { count: m.count, groupBy: m.groups } } }));
import { GET } from "./route";
const request = () => new Request("https://hub.test/api/operations/summary?from=2026-11-23&to=2026-11-23");
beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ role: "OPERATOR", userId: "u", organizationId: "org" }); m.count.mockResolvedValue(2); m.groups.mockResolvedValue([{ status: "OPEN", _count: { _all: 4 } }, { status: "COMPLETED", _count: { _all: 6 } }, { status: "DISREGARDED", _count: { _all: 3 } }]); });
it("scopes operators to their own activities and separates all-period risks from period goals", async () => {
  const response = await GET(request()), body = await response.json(); expect(response.status).toBe(200);
  for (const [query] of [...m.count.mock.calls, ...m.groups.mock.calls]) expect(query.where).toMatchObject({ organizationId: "org", responsibleId: "u", deletedAt: null });
  expect(body.period).toEqual({ total: 10, completed: 6, open: 4 }); expect(body.attention.awaitingApproval).toBe(2);
  expect(m.count.mock.calls[0][0].where).not.toHaveProperty("scheduledDate"); expect(m.count.mock.calls[0][0].where.OR[0].scheduledDate).toHaveProperty("lt");
});
it("allows management's organization summary and rejects invalid periods before querying", async () => {
  m.member.mockResolvedValue({ role: "MANAGER", organizationId: "org" }); await GET(request()); expect(m.groups.mock.calls[0][0].where).not.toHaveProperty("responsibleId");
  m.groups.mockClear(); expect((await GET(new Request("https://hub.test/api/operations/summary?from=2026-02-30"))).status).toBe(400); expect(m.groups).not.toHaveBeenCalled();
});
