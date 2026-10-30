export type ManagementAgent = { id: string | null; name: string; total: number; open: number; resolved: number };
export type WhatsAppManagementData = {
  summary: { total: number; open: number; resolved: number; queue: number };
  agents: ManagementAgent[];
  tickets: Array<{ id: string; senderName: string | null; subject: string; senderEmail: string; snippet: string | null; status: string; lastMessageAt: string; receivedAt: string; client: { id: string; name: string } | null; assignedTo: { id: string; name: string | null; email: string } | null }>;
  total: number; page: number; pageSize: number; updatedAt: string;
};
export function summarizeAssignments(groups: Array<{ assignedToId: string | null; status: string; _count: { _all: number } }>, members: Array<{ id: string; name: string | null; email: string }>) {
  const agents = new Map<string, ManagementAgent>(members.map(member => [member.id, { id: member.id, name: member.name || member.email, total: 0, open: 0, resolved: 0 }]));
  agents.set("QUEUE", { id: null, name: "Sem responsável", total: 0, open: 0, resolved: 0 });
  const summary = { total: 0, open: 0, resolved: 0, queue: 0 };
  for (const group of groups) {
    if (group.status === "SPAM") continue;
    const key = group.assignedToId || "QUEUE";
    const agent = agents.get(key) || { id: group.assignedToId, name: "Colaborador sem vínculo ativo", total: 0, open: 0, resolved: 0 };
    const count = group._count._all;
    agent.total += count; summary.total += count;
    if (group.status === "RESOLVED") { agent.resolved += count; summary.resolved += count; }
    else { agent.open += count; summary.open += count; if (!group.assignedToId) summary.queue += count; }
    agents.set(key, agent);
  }
  return { summary, agents: [...agents.values()].sort((a,b) => b.open - a.open || a.name.localeCompare(b.name, "pt-BR")) };
}
