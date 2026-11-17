import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), activities: vi.fn(), clients: vi.fn(), processes: vi.fn(), members: vi.fn(), configurations: vi.fn(), count: vi.fn() }));
vi.mock("@/modules/operations/auth", () => ({ getOperationMember: m.member }));
vi.mock("@/modules/operations/team-catalog", () => ({ operationTeamCatalog: async () => ({ values: ["Força Tatica Financeira", "Força Tatitca Financeira", "Elite Do Fluxo"], options: ["Elite do Fluxo", "Força Tática Financeira"] }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationActivity: { findMany: m.activities, count: m.count }, client: { findMany: m.clients }, operationProcess: { findMany: m.processes }, organizationMember: { findMany: m.members }, operationClientProcess: { findMany: m.configurations } } }));
import { GET } from "./route";
beforeEach(() => {
  vi.resetAllMocks(); m.member.mockResolvedValue({ userId: "u", organizationId: "org", role: "MASTER", canEdit: true });
  m.activities.mockResolvedValue([{ id: "a", team: "Força Tatitca Financeira" }]); m.configurations.mockResolvedValue([{ id: "r", team: "Elite Do Fluxo" }]); m.clients.mockResolvedValue([]); m.processes.mockResolvedValue([]); m.members.mockResolvedValue([]); m.count.mockResolvedValue(0);
});
it("filters all historical spellings and returns canonical labels with a standard selection", async () => {
  const response = await GET(new Request("https://hub.test/api/operations?team=" + encodeURIComponent("Força Tática Financeira")));
  const body = await response.json();
  expect(body.teams).toEqual(["Elite do Fluxo", "Força Tática Financeira"]);
  expect(body.activities[0].team).toBe("Força Tática Financeira"); expect(body.configurations[0].team).toBe("Elite do Fluxo");
  expect(m.activities.mock.calls[0][0].where).toMatchObject({ organizationId: "org", deletedAt: null, team: { in: ["Força Tática Financeira", "Força Tatica Financeira", "Força Tatitca Financeira"] } });
});
it("keeps operator assignment and organization boundaries while making standard teams selectable", async () => {
  m.member.mockResolvedValue({ userId: "u", organizationId: "org", role: "OPERATOR", canEdit: true });
  const body = await (await GET(new Request("https://hub.test/api/operations?responsibleId=someone-else"))).json();
  expect(m.activities.mock.calls[0][0].where).toMatchObject({ responsibleId: "u", organizationId: "org", deletedAt: null });
  expect(body.configurations).toEqual([]); expect(body.teams).toHaveLength(2);
  expect(m.configurations).not.toHaveBeenCalled();
});
