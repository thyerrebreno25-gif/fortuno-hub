"use client";

import {
  Alert,
  Modal,
  Stack,
  Switch,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconChartAreaLine,
  IconCheck,
  IconClock,
  IconFilter,
  IconInbox,
  IconMessageCircle,
  IconRefresh,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Breakdown, MonitoringData } from "@/modules/whatsapp/monitoring-types";
import { buildMonitoringDemo, demoClients, demoAgents, type DemoConversation } from "@/modules/whatsapp/monitoring-demo";
import styles from "./monitoring.module.css";

type Option = { value: string; label: string };

const statusLabels: Record<string, string> = {
  NEW: "Na fila",
  IN_PROGRESS: "Em atendimento",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_INTERNAL: "Aguardando resposta",
};

const areaColors = ["#228be6", "#20c997", "#845ef7", "#fd7e14", "#e64980"];

function inputDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeFromDays(days: number) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days + 1);
  return { from: inputDate(from), to: inputDate(to) };
}

function duration(minutes: number) {
  if (!minutes) return "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readData(response: Response) {
  const payload = (await response.json()) as MonitoringData & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o monitoramento.");
  return payload;
}

export function WhatsAppMonitoring({
  clients,
  members,
  onOpenTicket,
}: {
  clients: Option[];
  members: Option[];
  onOpenTicket: (id: string) => void;
}) {
  const initialRange = useMemo(() => rangeFromDays(30), []);
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [clientId, setClientId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [demo, setDemo] = useState(true);
  const [preview, setPreview] = useState<DemoConversation | null>(null);
  const demoResult = useMemo(() => buildMonitoringDemo({ from, to, clientId, assigneeId }), [from, to, clientId, assigneeId]);
  const [realData, setData] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [periodPreset, setPeriodPreset] = useState(30);

  const data = demo ? demoResult.data : realData;

  const load = useCallback(async (signal?: AbortSignal) => {
    if (demo) { setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      if (clientId) params.set("clientId", clientId);
      if (assigneeId) params.set("assigneeId", assigneeId);
      setData(
        await readData(
          await fetch(`/api/whatsapp/monitoring?${params}`, { cache: "no-store", signal }),
        ),
      );
    } catch (error) {
      if (signal?.aborted) return;
      setData(null);
      notifications.show({
        color: "red",
        title: "Monitoramento do WhatsApp",
        message: error instanceof Error ? error.message : "Não foi possível carregar os indicadores.",
      });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [demo, assigneeId, clientId, from, to]);

  useEffect(() => {
    const controller = new AbortController();
    // Sincroniza os indicadores sempre que algum filtro muda.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function selectPeriod(days: number) {
    const range = rangeFromDays(days);
    setPeriodPreset(days);
    setFrom(range.from);
    setTo(range.to);
  }

  return (
    <section className={styles.monitoring}>
      <Paper withBorder radius="lg" p="md">
        <Group justify="space-between">
          <div><Text fw={800}>{demo ? "Demonstração do painel" : "Indicadores reais"}</Text>
            <Text size="sm" c="dimmed">{demo ? "Explore os indicadores com conversas, clientes e equipe fictícios." : "Informações dos atendimentos registrados no WhatsApp."}</Text></div>
          <Switch label="Dados fictícios" checked={demo} onChange={(event) => { setDemo(event.currentTarget.checked); setClientId(null); setAssigneeId(null); setData(null); setPreview(null); }} />
        </Group>
      </Paper>
      {demo && <Alert color="blue" title="Modo demonstração — dados fictícios">Os exemplos servem apenas para visualizar o painel. Nenhuma mensagem é enviada e nenhum atendimento é gravado. Experimente os filtros ou abra uma conversa abaixo.</Alert>}
      {demo && demoResult.error && <Alert color="orange">{demoResult.error}</Alert>}
      <Modal opened={!!preview} onClose={() => setPreview(null)} title="Conversa fictícia" size="lg" centered>
        {preview && <Stack>
          <div><Text fw={800}>{preview.contact} · {preview.clientName}</Text><Text size="sm" c="dimmed">{preview.subject} · {preview.agentName}</Text><Badge mt="xs">{statusLabels[preview.status] || "Finalizada"}</Badge></div>
          {preview.messages.map((message, index) => <Paper key={index} withBorder p="sm" radius="md" bg={message.incoming ? undefined : "var(--mantine-color-blue-light)"}>
            <Text size="xs" fw={700} c="dimmed">{message.incoming ? preview.contact : preview.agentName}</Text><Text size="sm">{message.text}</Text>
          </Paper>)}
          <Text size="xs" c="dimmed">Exemplo ilustrativo, sem envio de mensagens.</Text>
        </Stack>}
      </Modal>
      <Paper withBorder radius="lg" p="md" className={styles.filters}>
        <Group justify="space-between" align="end" gap="md">
          <div>
            <Group gap={7} mb={4}>
              <IconFilter size={17} />
              <Text fw={800} size="sm">Visão do período</Text>
            </Group>
            <Text size="xs" c="dimmed">Cruze tempo, volume, cliente e desempenho da equipe.</Text>
          </div>
          <Group gap={6} className={styles.quickPeriods}>
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                size="compact-sm"
                variant={periodPreset === days ? "filled" : "subtle"}
                onClick={() => selectPeriod(days)}
              >
                {days} dias
              </Button>
            ))}
          </Group>
          <TextInput label="De" type="date" value={from} onChange={(event) => { setPeriodPreset(0); setFrom(event.currentTarget.value); }} />
          <TextInput label="Até" type="date" value={to} onChange={(event) => { setPeriodPreset(0); setTo(event.currentTarget.value); }} />
          <Select label="Cliente" placeholder="Todos os clientes" searchable clearable data={demo ? demoClients : clients} value={clientId} onChange={setClientId} />
          <Select label="Colaborador" placeholder="Toda a equipe" searchable clearable data={demo ? demoAgents : members} value={assigneeId} onChange={setAssigneeId} />
          <Tooltip label="Atualizar indicadores">
            <Button variant="light" px="sm" onClick={() => void load()} loading={!demo && loading}>
              <IconRefresh size={17} />
            </Button>
          </Tooltip>
        </Group>
      </Paper>

      {!demo && loading && !data ? (
        <div className={styles.loading}><Loader size="sm" /><Text>Calculando indicadores...</Text></div>
      ) : data ? (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, xl: 6 }} spacing="sm">
            <Metric title="Conversas" value={String(data.summary.conversations)} detail={`${data.summary.active} ainda ativas`} icon={<IconMessageCircle size={19} />} color="blue" />
            <Metric title="Na fila" value={String(data.summary.queue)} detail={`Espera média ${duration(data.summary.averageQueueMinutes)}`} icon={<IconInbox size={19} />} color="orange" />
            <Metric title="Primeira resposta" value={duration(data.summary.averageFirstResponseMinutes)} detail={`Cliente espera ${duration(data.summary.averageCustomerWaitMinutes)}`} icon={<IconClock size={19} />} color="cyan" />
            <Metric title="Duração média" value={duration(data.summary.averageHandlingMinutes)} detail="Da primeira resposta ao fim" icon={<IconChartAreaLine size={19} />} color="violet" />
            <Metric title="Resolvidos" value={`${data.summary.resolutionRate}%`} detail={`${data.summary.completed} finalizados`} icon={<IconCheck size={19} />} color="green" />
            <Metric title="Satisfação" value={data.summary.satisfaction ? `${data.summary.satisfaction}/5` : "—"} detail={`${data.summary.satisfactionResponses} respostas`} icon={<IconStar size={19} />} color="yellow" />
          </SimpleGrid>

          <div className={styles.primaryGrid}>
            <ChartCard title="Fluxo de atendimentos" subtitle="Entradas e finalizações ao longo do período" className={styles.flowCard}>
              <AreaFlowChart data={data.timeline} />
            </ChartCard>
            <ChartCard title="Distribuição por assunto" subtitle="De onde vem a demanda da equipe">
              <DonutChart data={data.areas} />
            </ChartCard>
          </div>

          <div className={styles.secondaryGrid}>
            <ChartCard title="Demanda por horário" subtitle="Horários com maior entrada de conversas">
              <HourlyBars data={data.hourly} />
            </ChartCard>
            <ChartCard title="Carga por colaborador" subtitle="Conversas assumidas no período">
              <AgentLoad data={data.agents} />
            </ChartCard>
          </div>

          <div className={styles.tableGrid}>
            <Paper withBorder radius="lg" className={styles.tableCard}>
              <div className={styles.cardHeading}>
                <div><Text fw={850}>Desempenho da equipe</Text><Text size="xs" c="dimmed">Tempo, produção e conclusão por colaborador</Text></div>
                <Badge variant="light" leftSection={<IconUsers size={13} />}>{data.agents.length} colaboradores</Badge>
              </div>
              <div className={styles.tableScroll}>
                <table>
                  <thead><tr><th>Colaborador</th><th>Conversas</th><th>Respostas</th><th>1ª resposta</th><th>Duração</th><th>Resolvidas</th><th>CSAT</th></tr></thead>
                  <tbody>
                    {data.agents.map((agent) => (
                      <tr key={agent.id}>
                        <td><strong>{agent.name}</strong><small>{agent.active} ativas agora</small></td>
                        <td>{agent.conversations}</td><td>{agent.messages}</td><td>{duration(agent.averageFirstResponseMinutes)}</td><td>{duration(agent.averageHandlingMinutes)}</td><td>{agent.resolved}</td><td>{agent.satisfaction ? `${agent.satisfaction}/5` : "—"}</td>
                      </tr>
                    ))}
                    {!data.agents.length && <tr><td colSpan={7} className={styles.emptyCell}>Sem atendimentos no período.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Paper>

            <Paper withBorder radius="lg" className={styles.tableCard}>
              <div className={styles.cardHeading}>
                <div><Text fw={850}>Clientes com maior demanda</Text><Text size="xs" c="dimmed">Volume e tempos médios por cliente</Text></div>
              </div>
              <div className={styles.tableScroll}>
                <table>
                  <thead><tr><th>Cliente</th><th>Conversas</th><th>Em aberto</th><th>1ª resposta</th><th>Duração</th><th>CSAT</th></tr></thead>
                  <tbody>
                    {data.clients.slice(0, 15).map((client) => (
                      <tr key={client.id}>
                        <td><strong>{client.name}</strong></td><td>{client.conversations}</td><td>{client.active}</td><td>{duration(client.averageFirstResponseMinutes)}</td><td>{duration(client.averageHandlingMinutes)}</td><td>{client.satisfaction ? `${client.satisfaction}/5` : "—"}</td>
                      </tr>
                    ))}
                    {!data.clients.length && <tr><td colSpan={6} className={styles.emptyCell}>Sem clientes no período.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Paper>
          </div>

          {demo && <Paper withBorder radius="lg" p="md">
            <Text fw={800} mb="sm">Conversas fictícias do período</Text>
            <SimpleGrid cols={{ base: 1, md: 3 }}>{demoResult.conversations.slice(-6).reverse().map((conversation) => <Paper key={conversation.id} withBorder radius="md" p="sm">
              <Stack gap="xs"><Group justify="space-between"><Text fw={700}>{conversation.contact}</Text><Badge size="xs">{statusLabels[conversation.status] || "Finalizada"}</Badge></Group>
                <Text size="sm">{conversation.clientName} · {conversation.subject}</Text><Text size="xs" c="dimmed">{conversation.agentName}</Text>
                <Button variant="light" size="xs" onClick={() => setPreview(conversation)}>Ver conversa</Button></Stack>
            </Paper>)}</SimpleGrid>
            {!demoResult.conversations.length && <Text size="sm" c="dimmed">Nenhum exemplo corresponde aos filtros selecionados.</Text>}
          </Paper>}

          <Paper withBorder radius="lg" className={styles.attentionCard}>
            <div className={styles.cardHeading}>
              <div><Text fw={850}>Atendimentos que precisam de atenção</Text><Text size="xs" c="dimmed">Conversas cuja última mensagem ainda é do cliente</Text></div>
              <Group gap="xs"><Badge color={data.summary.longestCurrentWaitMinutes > 60 ? "red" : "blue"} variant="light">Maior espera: {duration(data.summary.longestCurrentWaitMinutes)}</Badge></Group>
            </div>
            <div className={styles.tableScroll}>
              <table>
                <thead><tr><th>Contato</th><th>Cliente</th><th>Responsável</th><th>Status</th><th>Última mensagem</th><th>Sem resposta</th><th></th></tr></thead>
                <tbody>
                  {data.attention.map((item) => (
                    <tr key={item.id}>
                      <td><strong>{item.contact}</strong></td><td>{item.client}</td><td>{item.assignee}</td><td><Badge size="sm" variant="light" color={item.status === "NEW" ? "orange" : "blue"}>{statusLabels[item.status] || item.status}</Badge></td><td>{dateTime(item.lastMessageAt)}</td><td><span className={item.waitingMinutes > 60 ? styles.dangerTime : styles.waitTime}>{duration(item.waitingMinutes)}</span></td><td><Button size="compact-xs" variant="subtle" onClick={() => demo ? setPreview(demoResult.conversations.find((conversation) => conversation.id === item.id) || null) : onOpenTicket(item.id)}>Abrir</Button></td>
                    </tr>
                  ))}
                  {!data.attention.length && <tr><td colSpan={7} className={styles.emptyCell}>Nenhuma conversa aguardando resposta.</td></tr>}
                </tbody>
              </table>
            </div>
          </Paper>
        </>
      ) : null}
    </section>
  );
}

function Metric({ title, value, detail, icon, color }: { title: string; value: string; detail: string; icon: React.ReactNode; color: string }) {
  return (
    <Paper withBorder radius="lg" p="md" className={styles.metric} data-color={color}>
      <Group justify="space-between" wrap="nowrap">
        <div><Text size="xs" c="dimmed">{title}</Text><Text className={styles.metricValue}>{value}</Text></div>
        <div className={styles.metricIcon}>{icon}</div>
      </Group>
      <Text size="xs" c="dimmed" mt={8}>{detail}</Text>
    </Paper>
  );
}

function ChartCard({ title, subtitle, children, className = "" }: { title: string; subtitle: string; children: React.ReactNode; className?: string }) {
  return (
    <Paper withBorder radius="lg" className={`${styles.chartCard} ${className}`}>
      <div className={styles.cardHeading}><div><Text fw={850}>{title}</Text><Text size="xs" c="dimmed">{subtitle}</Text></div></div>
      <div className={styles.chartBody}>{children}</div>
    </Paper>
  );
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middle = (previous.x + current.x) / 2;
    path += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

function AreaFlowChart({ data }: { data: MonitoringData["timeline"] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 760;
  const height = 250;
  const pad = { left: 36, right: 18, top: 20, bottom: 35 };
  const max = Math.max(1, ...data.flatMap((item) => [item.received, item.resolved]));
  const step = data.length > 1 ? (width - pad.left - pad.right) / (data.length - 1) : 0;
  const points = (key: "received" | "resolved") =>
    data.map((item, index) => ({
      x: pad.left + index * step,
      y: pad.top + (height - pad.top - pad.bottom) * (1 - item[key] / max),
    }));
  const received = points("received");
  const resolved = points("resolved");
  const receivedPath = smoothPath(received);
  const resolvedPath = smoothPath(resolved);
  const areaPath = received.length
    ? `${receivedPath} L ${received.at(-1)?.x} ${height - pad.bottom} L ${received[0].x} ${height - pad.bottom} Z`
    : "";
  const tickEvery = Math.max(1, Math.ceil(data.length / 7));

  if (!data.length) return <div className={styles.noChart}>Sem dados no período.</div>;
  return (
    <div className={styles.areaChart}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fluxo de atendimentos">
        <defs><linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#228be6" stopOpacity=".28" /><stop offset="1" stopColor="#228be6" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map((ratio) => {
          const y = pad.top + (height - pad.top - pad.bottom) * ratio;
          return <g key={ratio}><line x1={pad.left} x2={width - pad.right} y1={y} y2={y} className={styles.gridLine} /><text x={pad.left - 9} y={y + 4} textAnchor="end" className={styles.axisText}>{Math.round(max * (1 - ratio))}</text></g>;
        })}
        <path d={areaPath} fill="url(#flowFill)" />
        <path d={receivedPath} className={styles.receivedLine} />
        <path d={resolvedPath} className={styles.resolvedLine} />
        {data.map((item, index) => {
          const x = received[index].x;
          const slot = Math.max(10, step || 40);
          return <g key={item.date} onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(null)}><rect x={x - slot / 2} y={pad.top} width={slot} height={height - pad.top - pad.bottom} fill="transparent" /><circle cx={x} cy={received[index].y} r={hovered === index ? 5 : 0} className={styles.receivedDot} /><circle cx={x} cy={resolved[index].y} r={hovered === index ? 5 : 0} className={styles.resolvedDot} />{index % tickEvery === 0 && <text x={x} y={height - 10} textAnchor="middle" className={styles.axisText}>{item.label}</text>}</g>;
        })}
      </svg>
      <div className={styles.chartLegend}><span><i className={styles.blueDot} />Recebidas</span><span><i className={styles.greenDot} />Finalizadas</span></div>
      {hovered !== null && data[hovered] && (
        <div className={styles.chartTooltip} style={{ left: `${Math.min(82, Math.max(8, (received[hovered].x / width) * 100))}%` }}>
          <strong>{data[hovered].label}</strong><span>{data[hovered].received} recebidas</span><span>{data[hovered].resolved} finalizadas</span><span>Resposta: {duration(data[hovered].averageResponseMinutes)}</span>
        </div>
      )}
    </div>
  );
}

function DonutChart({ data }: { data: MonitoringData["areas"] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const gradient = data.length
    ? data.map((item, index) => { const start = cursor; cursor += total ? (item.value / total) * 100 : 0; return `${areaColors[index % areaColors.length]} ${start}% ${cursor}%`; }).join(", ")
    : "#dfe6ee 0 100%";
  return (
    <div className={styles.donutLayout}>
      <div className={styles.donut} style={{ background: `conic-gradient(${gradient})` }}><div><strong>{active !== null ? data[active]?.value || 0 : total}</strong><span>{active !== null ? "conversas" : "no período"}</span></div></div>
      <div className={styles.donutLegend}>
        {data.map((item, index) => (
          <button key={item.label} type="button" onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)}><i style={{ background: areaColors[index % areaColors.length] }} /><span>{item.label}</span><strong>{total ? Math.round((item.value / total) * 100) : 0}%</strong></button>
        ))}
        {!data.length && <Text size="sm" c="dimmed">Sem conversas no período.</Text>}
      </div>
    </div>
  );
}

function HourlyBars({ data }: { data: MonitoringData["hourly"] }) {
  const max = Math.max(1, ...data.map((item) => item.conversations));
  return (
    <div className={styles.hourlyChart}>
      {data.map((item) => (
        <Tooltip key={item.hour} label={`${item.label}: ${item.conversations} conversa(s)`}>
          <div className={styles.hourColumn}><div className={styles.hourBar} style={{ height: `${Math.max(item.conversations ? 8 : 2, (item.conversations / max) * 100)}%` }} /><span>{item.hour % 3 === 0 ? item.label : ""}</span></div>
        </Tooltip>
      ))}
    </div>
  );
}

function AgentLoad({ data }: { data: Breakdown[] }) {
  const top = data.slice(0, 6);
  const max = Math.max(1, ...top.map((item) => item.conversations));
  return (
    <div className={styles.agentBars}>
      {top.map((agent) => (
        <div key={agent.id} className={styles.agentRow}>
          <div><strong>{agent.name}</strong><span>{agent.resolved} resolvidas · {duration(agent.averageFirstResponseMinutes)} resposta</span></div>
          <div className={styles.agentTrack}><div style={{ width: `${(agent.conversations / max) * 100}%` }} /></div>
          <b>{agent.conversations}</b>
        </div>
      ))}
      {!top.length && <div className={styles.noChart}>Sem atividade no período.</div>}
    </div>
  );
}
