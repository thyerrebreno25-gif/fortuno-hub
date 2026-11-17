import { expect, it } from "vitest";
import { canonicalTeam, operationTeamOptions, teamAliases } from "./teams";
import { analyticsPeriod, buildOperationsAnalytics, type AnalyticsActivity } from "./analytics";

it("unifies accents, case, repeated spaces and invisible characters using the standard names", () => {
  for (const name of [" Força Tática Financeira ", "forca tatica financeira", "Força Tatitca Financeira", "Força  Tática\u00a0Financeira\u200b"]) expect(canonicalTeam(name)).toBe("Força Tática Financeira");
  expect(operationTeamOptions(["Elite Do Fluxo", "elite do fluxo", "Força Tática Financeira", " ", null])).toEqual(["Elite do Fluxo", "Força Tática Financeira"]);
  expect(operationTeamOptions(["Equipe NORTE", "equipe norte", "Equipe Sul"])).toHaveLength(4);
});
it("keeps every legacy variant available to the database filter without matching other teams", () => {
  const variants = teamAliases("Força Tática Financeira", ["Força Tática Financeira ", "forca tatica financeira", "Elite Do Fluxo"]);
  expect(variants).toEqual(["Força Tática Financeira", "Força Tática Financeira ", "forca tatica financeira"]);
});
it("consolidates workload and time from legacy labels without duplicating activities or losing time", () => {
  const now = new Date("2026-11-17T18:00:00Z");
  const activity = (id: string, team: string): AnalyticsActivity => ({ id, team, title: "Atividade", status: "COMPLETED", scheduledDate: now, createdAt: now, dueAt: now, completedAt: now, responsibleId: "u", responsible: { id: "u", name: "Pessoa", email: "u@test" }, client: { id: "c", name: "Cliente", cluster: "A" }, clientCluster: "A", process: { id: "p", name: "Processo" } });
  const activities = [activity("a", "Elite do Fluxo"), activity("b", "Elite Do Fluxo "), activity("c", "Força Tática Financeira"), activity("d", "Força Tatitca Financeira")];
  const entries = activities.map((row, index) => ({ id: `${index}`, activityId: row.id, userId: "u", startedAt: new Date("2026-11-17T12:00:00Z"), endedAt: new Date("2026-11-17T13:00:00Z"), seconds: 600, user: row.responsible!, activity: row }));
  const result = buildOperationsAnalytics(activities, entries, analyticsPeriod("2026-11-17", "2026-11-17"), now);
  expect(result.byTeam).toHaveLength(2);
  expect(result.byTeam.map(team => [team.planned, team.completed, team.seconds])).toEqual([[2, 2, 1200], [2, 2, 1200]]);
  expect(result.summary.seconds).toBe(2400);
});
