import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ activities: vi.fn(), routines: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { operationActivity: { findMany: m.activities }, operationClientProcess: { findMany: m.routines } } }));
import { operationTeamCatalog } from "./team-catalog";
it("builds one tenant-scoped selection from historical activities and active routines, preserving raw aliases for filtering", async () => {
  m.activities.mockResolvedValue([{ team: "Elite Do Fluxo" }, { team: "Elite do Fluxo " }]);
  m.routines.mockResolvedValue([{ team: "forca tatica financeira" }]);
  const result = await operationTeamCatalog("org");
  expect(result.options).toEqual(["Elite do Fluxo", "Força Tática Financeira"]);
  expect(result.values).toContain("Elite do Fluxo ");
  expect(m.activities.mock.calls[0][0].where).toMatchObject({ organizationId: "org", deletedAt: null });
  expect(m.routines.mock.calls[0][0].where).toMatchObject({ client: { organizationId: "org" }, active: true });
});
