import { describe, expect, it } from "vitest";
import { buildMonitoringDemo, demoClients, demoAgents } from "./monitoring-demo";
const now = new Date("2026-10-16T18:00:00Z");
const range = { from: "2026-09-17", to: "2026-10-16" };
describe("painel fictício do WhatsApp", () => {
  it("mantém gráficos, indicadores e conversas consistentes", () => {
    const { data, conversations } = buildMonitoringDemo(range, now);
    expect(data.summary.conversations).toBe(conversations.length);
    expect(data.summary.active + data.summary.completed).toBe(conversations.length);
    for (const sum of [data.timeline.reduce((s, r) => s + r.received, 0), data.hourly.reduce((s, r) => s + r.conversations, 0), data.areas.reduce((s, r) => s + r.value, 0), data.clients.reduce((s, r) => s + r.conversations, 0), data.agents.reduce((s, r) => s + r.conversations, 0)]) expect(sum).toBe(conversations.length);
    expect(data.attention.length).toBeGreaterThan(0);
    for (const row of data.attention) {
      const conversation = conversations.find((c) => c.id === row.id)!;
      expect(conversation.messages.at(-1)?.incoming).toBe(true);
      expect(conversation.status).not.toBe("RESOLVED");
      expect(row.id.startsWith("demo-")).toBe(true);
    }
  });
  it("filtra cliente e colaborador sem alterar as conversas de dias em comum", () => {
    const all = buildMonitoringDemo(range, now).conversations;
    const filters = { ...range, from: "2026-10-10", clientId: demoClients[0].value, assigneeId: demoAgents[0].value };
    expect(buildMonitoringDemo(filters, now).conversations).toEqual(all.filter((r) => r.date >= filters.from && r.clientId === filters.clientId && r.agentId === filters.assigneeId));
  });
  it("trata datas vazias, invertidas, extensas e períodos sem dados", () => {
    for (const filters of [{ from: "", to: "" }, { from: range.to, to: range.from }, { from: "2020-01-01", to: range.to }]) {
      const result = buildMonitoringDemo(filters, now);
      expect(result.error).toBeTruthy();
      expect(result.data.summary.conversations).toBe(0);
    }
    expect(buildMonitoringDemo({ from: "2027-01-01", to: "2027-01-07" }, now).data.summary.conversations).toBe(0);
  });
});
