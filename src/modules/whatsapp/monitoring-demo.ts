import type { Breakdown, MonitoringData } from "./monitoring-types";

export const demoClients = [
  { value: "demo-clinica", label: "Clínica Aurora (fictício)" },
  { value: "demo-mercado", label: "Mercado Horizonte (fictício)" },
  { value: "demo-studio", label: "Studio Ipê (fictício)" },
  { value: "demo-oficina", label: "Oficina Boa Rota (fictício)" },
];
export const demoAgents = [
  { value: "demo-ana", label: "Ana Lima (fictícia)" },
  { value: "demo-bruno", label: "Bruno Alves (fictício)" },
  { value: "demo-carla", label: "Carla Souza (fictícia)" },
];
const scenarios = [
  { contact: "Mariana", subject: "Comprovante de pagamento", area: "Contas a pagar", question: "Olá! Podem conferir o pagamento do fornecedor de materiais?", answer: "Olá! Conferi o agendamento e o pagamento foi concluído. O comprovante está disponível.", followup: "Obrigada! Conseguem conferir também o vencimento da próxima parcela?" },
  { contact: "Rafael", subject: "Segunda via de boleto", area: "Contas a receber", question: "Bom dia! Preciso da segunda via do boleto deste mês.", answer: "Bom dia! Localizei a cobrança e preparei a segunda via para conferência.", followup: "Podem confirmar a data de vencimento antes de eu pagar?" },
  { contact: "Juliana", subject: "Conciliação de recebimentos", area: "Contas a receber", question: "Um recebimento por Pix ainda não apareceu no relatório. Podem verificar?", answer: "Localizei o recebimento e atualizei a conciliação. Já consta no relatório.", followup: "Há outro recebimento de ontem. Conseguem verificar também?" },
  { contact: "Pedro", subject: "Atualização cadastral", area: "Atendimento geral", question: "Olá! Como atualizo o contato responsável pelo financeiro?", answer: "Olá! Recebi os dados e concluí a atualização do contato financeiro.", followup: "Obrigada! A mudança também vale para os avisos de vencimento?" },
  { contact: "Camila", subject: "Aprovação de despesas", area: "Contas a pagar", question: "As despesas da semana já estão disponíveis para aprovação?", answer: "Sim! Revisei os documentos e organizei as despesas por vencimento.", followup: "Podem separar as despesas que vencem ainda hoje?" },
  { contact: "Lucas", subject: "Relatório mensal", area: "Atendimento geral", question: "Podem me ajudar a entender o fechamento financeiro do mês?", answer: "Claro! Revisei o fechamento e preparei um resumo das entradas e saídas.", followup: "Conseguem detalhar as despesas por categoria?" },
  { contact: "Beatriz", subject: "Proposta de serviços", area: "Comercial", question: "Olá! Gostaria de uma proposta para incluir mais uma empresa no atendimento financeiro.", answer: "Olá! Preparei uma proposta com o escopo, os prazos e as condições para a nova empresa.", followup: "Podemos agendar uma apresentação da proposta para amanhã?" },
  { contact: "Eduardo", subject: "Planejamento e resultados", area: "Diretoria", question: "Bom dia! Precisamos revisar os resultados do trimestre e as prioridades do próximo mês.", answer: "Bom dia! Organizei o resumo dos indicadores e uma sugestão de prioridades para a reunião da diretoria.", followup: "Podem incluir uma projeção de caixa para os próximos três meses?" },
  { contact: "Fernanda", subject: "Revisão de pendências da equipe", area: "Supervisão", question: "Olá! Quais atendimentos precisam de apoio da supervisão para serem concluídos hoje?", answer: "Olá! Revisei as pendências e organizei os responsáveis e os próximos passos de cada atendimento.", followup: "Podem priorizar os casos que dependem de retorno de outros setores?" },
];
export type DemoConversation = {
  id: string; date: string; hour: number; contact: string; subject: string; area: string;
  clientId: string; clientName: string; agentId: string; agentName: string;
  status: string; response: number; handling: number; waiting: number; score: number | null;
  lastMessageAt: string; messages: Array<{ incoming: boolean; text: string }>;
};
const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
const score = (rows: DemoConversation[]) => {
  const values = rows.flatMap((row) => row.score === null ? [] : [row.score]);
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
};
const completed = (row: DemoConversation) => row.status === "RESOLVED";

export function buildMonitoringDemo(filters: { from: string; to: string; clientId?: string | null; assigneeId?: string | null }, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = Date.parse(`${filters.from}T12:00:00Z`);
  const end = Date.parse(`${filters.to}T12:00:00Z`);
  const days = Math.round((end - start) / 86400000) + 1;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(filters.from) && /^\d{4}-\d{2}-\d{2}$/.test(filters.to) && Number.isFinite(days) && days > 0 && days <= 370;
  const all: DemoConversation[] = [];
  // Histórico fixo por data: mudar o período não modifica os exemplos dos dias em comum.
  for (let offset = 89; offset >= 0; offset--) {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
    const seed = Math.floor(Date.parse(date) / 86400000);
    for (let index = 0; index < 4 + seed % 5; index++) {
      const scenario = scenarios[(seed + index) % scenarios.length];
      const client = demoClients[(seed + index) % demoClients.length];
      const agent = demoAgents[(seed + index * 2) % demoAgents.length];
      const status = offset > 1 || index % 5 === 0 ? "RESOLVED" : ["NEW", "IN_PROGRESS", "WAITING_INTERNAL", "WAITING_CUSTOMER"][index % 4];
      const waiting = status === "RESOLVED" || status === "WAITING_CUSTOMER" ? 0 : 12 + index * 19;
      const messages = status === "NEW" ? [{ incoming: true, text: scenario.question }] : [
        { incoming: true, text: scenario.question }, { incoming: false, text: scenario.answer },
        ...(status === "WAITING_CUSTOMER" ? [{ incoming: false, text: "Pode confirmar se ficou tudo certo ou se precisa de mais alguma informação?" }] : [{ incoming: true, text: status === "RESOLVED" ? "Tudo certo, obrigada pela ajuda!" : scenario.followup }]),
      ];
      all.push({ id: `demo-${date}-${index}`, date, hour: 8 + (index * 2 + seed) % 10,
        contact: scenario.contact, subject: scenario.subject, area: scenario.area,
        clientId: client.value, clientName: client.label, agentId: agent.value, agentName: agent.label,
        status, response: status === "NEW" ? 0 : 3 + (seed + index * 3) % 18,
        handling: status === "RESOLVED" ? 15 + (seed + index * 7) % 70 : 0,
        waiting, score: status === "RESOLVED" && index % 3 !== 0 ? (index % 4 === 0 ? 4 : 5) : null,
        lastMessageAt: waiting ? new Date(now.getTime() - waiting * 60000).toISOString() : `${date}T15:00:00-03:00`, messages });
    }
  }
  const conversations = valid ? all.filter((row) => row.date >= filters.from && row.date <= filters.to && (!filters.clientId || row.clientId === filters.clientId) && (!filters.assigneeId || row.agentId === filters.assigneeId)) : [];
  const resolved = conversations.filter(completed);
  const active = conversations.filter((row) => !completed(row));
  const waiting = active.filter((row) => row.waiting > 0);
  const breakdown = (options: typeof demoClients, key: "clientId" | "agentId"): Breakdown[] => options.map((option) => {
    const rows = conversations.filter((row) => row[key] === option.value);
    return { id: option.value, name: option.label, conversations: rows.length, active: rows.filter((row) => !completed(row)).length,
      resolved: rows.filter(completed).length, messages: rows.reduce((sum, row) => sum + row.messages.filter((message) => !message.incoming).length, 0),
      averageFirstResponseMinutes: average(rows.filter((row) => row.status !== "NEW").map((row) => row.response)), averageHandlingMinutes: average(rows.filter(completed).map((row) => row.handling)), satisfaction: score(rows) };
  }).filter((row) => row.conversations).sort((a, b) => b.conversations - a.conversations);
  const data: MonitoringData = {
    period: { from: filters.from, to: filters.to, days: valid ? days : 0 },
    summary: { conversations: conversations.length, active: active.length, queue: active.filter((row) => row.status === "NEW").length,
      completed: resolved.length, resolutionRate: conversations.length ? Math.round(resolved.length / conversations.length * 100) : 0,
      averageQueueMinutes: average(active.filter((row) => row.status === "NEW").map((row) => row.waiting)),
      averageFirstResponseMinutes: average(conversations.filter((row) => row.status !== "NEW").map((row) => row.response)),
      averageHandlingMinutes: average(resolved.map((row) => row.handling)), averageCustomerWaitMinutes: average(waiting.map((row) => row.waiting)),
      longestCurrentWaitMinutes: Math.max(0, ...waiting.map((row) => row.waiting)), satisfaction: score(conversations), satisfactionResponses: conversations.filter((row) => row.score !== null).length },
    timeline: Array.from({ length: valid ? days : 0 }, (_, index) => {
      const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
      const rows = conversations.filter((row) => row.date === date);
      return { date, label: `${date.slice(8)}/${date.slice(5, 7)}`, received: rows.length, resolved: rows.filter(completed).length, averageResponseMinutes: average(rows.filter((row) => row.status !== "NEW").map((row) => row.response)) };
    }),
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${String(hour).padStart(2, "0")}h`, conversations: conversations.filter((row) => row.hour === hour).length })),
    areas: [...new Set(scenarios.map((scenario) => scenario.area))].map((label) => ({ label, value: conversations.filter((row) => row.area === label).length })).filter((row) => row.value),
    clients: breakdown(demoClients, "clientId"), agents: breakdown(demoAgents, "agentId"),
    attention: waiting.sort((a, b) => b.waiting - a.waiting).map((row) => ({ id: row.id, contact: row.contact, client: row.clientName, assignee: row.agentName, status: row.status, waitingMinutes: row.waiting, lastMessageAt: row.lastMessageAt })),
  };
  return { data, conversations, error: valid ? null : "Selecione um período válido de até 370 dias." };
}
