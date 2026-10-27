"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Alert, Badge, Button, Group, Loader, Pagination, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from "@mantine/core";
import { IconArrowRight, IconDownload, IconRefresh } from "@tabler/icons-react";
import { brazilDay, shiftDay, type AnalyticsGroup, type OperationsAnalytics } from "./analytics";
import styles from "./analytics-panel.module.css";
type Options = { clients: Array<{ id: string; name: string }>; operators: Array<{ id: string; name: string }>; processes: Array<{ id: string; name: string }>; teams: string[] };
type Data = OperationsAnalytics & { options: Options; ownOnly: boolean; currentUserId: string };
const emptyOptions: Options = { clients: [], operators: [], processes: [], teams: [] };
const time = (seconds: number, precise = false) => `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}m${precise ? ` ${String(Math.floor(seconds % 60)).padStart(2, "0")}s` : ""}`;
const dateLabel = (value: string) => value.slice(0, 10).split("-").reverse().join("/");
const statusNames: Record<string, string> = { OPEN: "Abertas", IN_PROGRESS: "Em andamento", BLOCKED: "Impedidas", COMPLETED: "Concluídas", DISREGARDED: "Desconsideradas" };
const statusColors: Record<string, string> = { OPEN: "blue", IN_PROGRESS: "cyan", BLOCKED: "red", COMPLETED: "teal", DISREGARDED: "gray" };
const statusHex: Record<string, string> = { OPEN: "#228be6", IN_PROGRESS: "#15aabf", BLOCKED: "#fa5252", COMPLETED: "#12b886", DISREGARDED: "#868e96" };
function comparison(value: number, previous: number, duration = false) {
  if (!previous) return value ? "Sem base no período anterior" : "Sem variação no período";
  const diff = value - previous, percentage = Math.round(diff / previous * 100);
  return `${diff >= 0 ? "+" : "−"}${duration ? time(Math.abs(diff)) : Math.abs(diff)} (${percentage > 0 ? "+" : ""}${percentage}%) vs. anterior`;
}
function csvCell(value: unknown) { const text = String(value ?? ""); return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`; }
function downloadCsv(filename: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Trend({ data }: { data: Data }) {
  const width = 760, height = 215, left = 54, right = 18, top = 18, bottom = 32;
  const peak = Math.max(3600, ...data.daily.map((point) => point.seconds));
  const x = (index: number) => left + index / Math.max(1, data.daily.length - 1) * (width - left - right);
  const y = (seconds: number) => height - bottom - seconds / peak * (height - top - bottom);
  const points = data.daily.map((point, index) => `${x(index)},${y(point.seconds)}`).join(" ");
  const ticks = [...new Set([0, Math.floor((data.daily.length - 1) / 3), Math.floor((data.daily.length - 1) * 2 / 3), data.daily.length - 1])];
  return <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolução diária do tempo apontado de ${dateLabel(data.period.from)} a ${dateLabel(data.period.to)}. Total ${time(data.summary.seconds)}.`}>
    {[0, 0.5, 1].map((fraction) => <g key={fraction}><line className={styles.chartGrid} x1={left} x2={width - right} y1={y(peak * fraction)} y2={y(peak * fraction)} /><text x={left - 10} y={y(peak * fraction) + 4} textAnchor="end">{(peak * fraction / 3600).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h</text></g>)}
    <polygon points={`${left},${height - bottom} ${points} ${x(data.daily.length - 1)},${height - bottom}`} fill="#228be6" opacity="0.1" />
    <polyline points={points} fill="none" stroke="#228be6" strokeWidth="2.5" strokeLinejoin="round" />
    {data.daily.map((point, index) => <circle key={point.date} cx={x(index)} cy={y(point.seconds)} r={data.daily.length > 62 ? 1.5 : 3} fill="#228be6"><title>{dateLabel(point.date)}: {time(point.seconds, true)} · {point.planned} atividade(s) programada(s)</title></circle>)}
    {ticks.map((index) => <text key={index} x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === data.daily.length - 1 ? "end" : "middle"}>{dateLabel(data.daily[index].date).slice(0, 5)}</text>)}
  </svg>;
}

function GroupTable({ rows, label, onInspect }: { rows: AnalyticsGroup[]; label: string; onInspect?: (id: string) => void }) {
  const [page, setPage] = useState(1), [sort, setSort] = useState<string | null>("time");
  const sorted = [...rows].sort((a, b) => sort === "planned" ? b.planned - a.planned || b.seconds - a.seconds : sort === "pending" ? b.pending - a.pending || b.seconds - a.seconds : sort === "average" ? b.averageSeconds - a.averageSeconds : b.seconds - a.seconds || b.planned - a.planned);
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 12)));
  return <Stack gap="sm"><Group justify="space-between"><Text size="sm" c="dimmed">{rows.length} {label.toLowerCase()}{onInspect ? " · clique no nome para detalhar." : ""}</Text><Select aria-label={`Ordenar ${label.toLowerCase()}`} w={210} allowDeselect={false} value={sort} onChange={(value) => { setSort(value); setPage(1); }} data={[{ value: "time", label: "Maior tempo apontado" }, { value: "planned", label: "Mais atividades programadas" }, { value: "pending", label: "Mais pendências" }, { value: "average", label: "Maior tempo médio" }]} /></Group>
    <ScrollArea><Table highlightOnHover miw={1060} verticalSpacing="sm"><Table.Thead><Table.Tr>{[label, "Programadas", "Concluídas", "Pendentes", "Trabalhadas", "Tempo apontado", "Média / trabalhada", "% do tempo", "Período anterior"].map((name) => <Table.Th key={name}>{name}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{sorted.slice((current - 1) * 12, current * 12).map((row) => <Table.Tr key={row.id}><Table.Td>{onInspect ? <button type="button" className={styles.nameButton} onClick={() => onInspect(row.id)}>{row.name}</button> : <Text size="sm">{row.name}</Text>}{row.withoutTime > 0 && <Text size="xs" c="dimmed">{row.withoutTime} programada(s) sem tempo registrado</Text>}</Table.Td><Table.Td>{row.planned}</Table.Td><Table.Td>{row.completed}</Table.Td><Table.Td><Badge variant="light" color={row.overdue ? "orange" : "gray"}>{row.pending}{row.overdue ? ` · ${row.overdue} atrasada(s)` : ""}</Badge></Table.Td><Table.Td>{row.worked}</Table.Td><Table.Td className={styles.numeric}><Text fw={750} size="sm">{time(row.seconds, true)}</Text>{row.runningSeconds > 0 && <Text size="xs" c="cyan">{time(row.runningSeconds)} em cronômetro ativo</Text>}</Table.Td><Table.Td className={styles.numeric}>{row.worked ? time(row.averageSeconds) : "—"}</Table.Td><Table.Td>{row.share.toFixed(1).replace(".", ",")}%</Table.Td><Table.Td><Text size="sm">{time(row.previousSeconds)}</Text><Text size="xs" c="dimmed">{comparison(row.seconds, row.previousSeconds, true)}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>
    {!rows.length && <Text c="dimmed" ta="center" py="xl">Sem registros para estes filtros.</Text>}{rows.length > 12 && <Pagination total={Math.ceil(rows.length / 12)} value={current} onChange={setPage} size="sm" />}
  </Stack>;
}

export function OperationsAnalyticsPanel({ onOpenActivity, onOpenActivities }: { onOpenActivity: (id: string) => void; onOpenActivities: () => void }) {
  const today = brazilDay();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`), [to, setTo] = useState(today), [preset, setPreset] = useState("month");
  const [filters, setFilters] = useState({ clientId: "", operatorId: "", processId: "", team: "", cluster: "" });
  const [data, setData] = useState<Data | null>(null), [options, setOptions] = useState<Options>(emptyOptions), [loading, setLoading] = useState(true), [error, setError] = useState(""), [reload, setReload] = useState(0);
  const [tab, setTab] = useState<string | null>("clients"), [activitySearch, setActivitySearch] = useState(""), [page, setPage] = useState(1), [inspect, setInspect] = useState<{ kind: "client" | "operator" | "process"; id: string; name: string } | null>(null);
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true); setError("");
      try {
        const query = new URLSearchParams({ from, to });
        for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
        const response = await fetch(`/api/operations/analytics?${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível consultar os indicadores.");
        if (active) { setData(result); setOptions(result.options); }
      } catch (cause) { if (active && !controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Falha na consulta."); setData(null); } }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; controller.abort(); };
  }, [from, to, filters, reload]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setReload((value) => value + 1); };
    const timer = window.setInterval(refresh, 60000); document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const activityRows = useMemo(() => (data?.activities || []).filter((row) => !inspect || (inspect.kind === "client" ? row.clientId === inspect.id : inspect.kind === "operator" ? (inspect.id === "unassigned" ? row.responsibleId === null : row.responsibleId === inspect.id || row.operators.some((operator) => operator.id === inspect.id)) : row.processId === inspect.id)).filter((row) => `${row.title} ${row.client} ${row.process} ${row.responsible} ${row.operators.map((author) => author.name).join(" ")}`.toLocaleLowerCase("pt-BR").includes(activitySearch.toLocaleLowerCase("pt-BR"))), [data, inspect, activitySearch]);
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(activityRows.length / 15)));
  function changePreset(value: string) {
    const now = brazilDay(); setPreset(value); setTo(now); setInspect(null); setPage(1);
    setFrom(value === "today" ? now : value === "week" ? shiftDay(now, -6) : value === "30days" ? shiftDay(now, -29) : `${now.slice(0, 7)}-01`);
    if (value === "previous") { const end = shiftDay(`${now.slice(0, 7)}-01`, -1); setFrom(`${end.slice(0, 7)}-01`); setTo(end); }
  }
  function drill(kind: "client" | "operator" | "process", id: string, name: string) { setInspect({ kind, id, name }); setActivitySearch(""); setPage(1); setTab("activities"); requestAnimationFrame(() => details.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }
  function exportRows() {
    if (!data) return;
    const dates = ["Início", "Fim", "Atualizado em"];
    const basis = [data.period.from, data.period.to, data.generatedAt];
    if (tab === "activities") downloadCsv(`fortuno-atividades-${data.period.from}-${data.period.to}.csv`, [[...dates, "Atividade", "Cliente", "Processo", "Responsável", "Programada no período", "Situação atual", "Tempo (segundos)", "Tempo apontado", "Participantes dos apontamentos"], ...activityRows.map((row) => [...basis, row.title, row.client, row.process, row.responsible, row.planned ? "Sim" : "Não", statusNames[row.status], row.seconds, time(row.seconds, true), row.operators.map((author) => `${author.name}: ${time(author.seconds, true)}`).join(" | ")])]);
    else {
      const rows = tab === "operators" ? data.byOperator : tab === "processes" ? data.byProcess : tab === "teams" ? data.byTeam : tab === "clusters" ? data.byCluster : data.byClient;
      downloadCsv(`fortuno-tempo-${tab}-${data.period.from}-${data.period.to}.csv`, [[...dates, "Grupo", "Programadas", "Concluídas", "Pendentes", "Atrasadas", "Trabalhadas", "Tempo (segundos)", "Tempo apontado", "Média por atividade trabalhada (segundos)", "Participação (%)", "Tempo anterior (segundos)"], ...rows.map((row) => [...basis, row.name, row.planned, row.completed, row.pending, row.overdue, row.worked, row.seconds, time(row.seconds, true), row.averageSeconds, row.share.toFixed(2), row.previousSeconds])]);
    }
  }
  const metrics = data ? [
    { label: "Tempo apontado", value: time(data.summary.seconds), detail: comparison(data.summary.seconds, data.previous.seconds, true), color: "#228be6" },
    { label: "Atividades programadas", value: data.summary.planned, detail: comparison(data.summary.planned, data.previous.planned), color: "#7950f2" },
    { label: "Concluídas", value: data.summary.completed, detail: "Das programadas no período", color: "#12b886" },
    { label: "Pendentes", value: data.summary.pending, detail: `${data.summary.overdue} atrasada(s) · ${data.summary.blocked} impedida(s)`, color: "#f59f00" },
    { label: "Clientes no período", value: data.summary.clients, detail: `${data.summary.operators} operador(es) com apontamento`, color: "#15aabf" },
    { label: "Tempo médio / atividade", value: data.summary.worked ? time(data.summary.averageSeconds) : "—", detail: `${data.summary.worked} atividade(s) trabalhada(s)`, color: "#e64980" },
  ] : [];
  return <Stack gap="lg" aria-busy={loading}>
    <Group justify="space-between"><Title order={4}>Painel de tempo e demanda</Title><Group gap="xs"><Button variant="default" leftSection={<IconRefresh size={16} />} loading={loading} onClick={() => setReload((value) => value + 1)}>Atualizar painel</Button><Button variant="light" leftSection={<IconDownload size={16} />} disabled={!data || loading} onClick={exportRows}>Exportar CSV</Button></Group></Group>
    <Paper withBorder radius="lg" p="lg"><Stack gap="sm"><Group gap="xs">{[["today", "Hoje"], ["week", "Últimos 7 dias"], ["month", "Este mês"], ["previous", "Mês passado"], ["30days", "Últimos 30 dias"]].map(([key, label]) => <Button size="xs" key={key} variant={preset === key ? "filled" : "default"} onClick={() => changePreset(key)}>{label}</Button>)}</Group><SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}><TextInput label="De" type="date" value={from} onChange={(event) => { setFrom(event.currentTarget.value); setPreset("custom"); setInspect(null); }} /><TextInput label="Até" type="date" value={to} onChange={(event) => { setTo(event.currentTarget.value); setPreset("custom"); setInspect(null); }} /><Select label="Cliente" searchable clearable placeholder="Todos os clientes" data={options.clients.map((client) => ({ value: client.id, label: client.name }))} value={filters.clientId || null} onChange={(value) => { setFilters({ ...filters, clientId: value || "" }); setInspect(null); }} /><Select label="Operador dos apontamentos" searchable clearable={!data?.ownOnly} disabled={data?.ownOnly} placeholder="Todos os operadores" data={options.operators.map((operator) => ({ value: operator.id, label: operator.name }))} value={data?.ownOnly ? data.currentUserId : filters.operatorId || null} onChange={(value) => { setFilters({ ...filters, operatorId: value || "" }); setInspect(null); }} /></SimpleGrid><SimpleGrid cols={{ base: 1, sm: 3 }}><Select label="Processo" searchable clearable placeholder="Todos os processos" data={options.processes.map((process) => ({ value: process.id, label: process.name }))} value={filters.processId || null} onChange={(value) => { setFilters({ ...filters, processId: value || "" }); setInspect(null); }} /><Select label="Equipe da atividade" searchable clearable placeholder="Todas as equipes" data={options.teams} value={filters.team || null} onChange={(value) => { setFilters({ ...filters, team: value || "" }); setInspect(null); }} /><Select label="Cluster" clearable placeholder="Todos os clusters" data={["A", "B", "C"]} value={filters.cluster || null} onChange={(value) => { setFilters({ ...filters, cluster: value || "" }); setInspect(null); }} /></SimpleGrid>{data && <Text size="xs" c="dimmed">Resultado de {dateLabel(data.period.from)} a {dateLabel(data.period.to)} · comparação com {dateLabel(data.previousPeriod.from)} a {dateLabel(data.previousPeriod.to)} · horário de Brasília. Atualizado em {new Date(data.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}. Atualização automática a cada 60 segundos.</Text>}{data?.ownOnly && <Text size="xs" c="dimmed">Seu perfil consulta seus apontamentos e as atividades sob sua responsabilidade.</Text>}</Stack></Paper>
    {error && <Alert color="red" title="Não foi possível carregar o painel">{error}</Alert>}
    {!data && loading && <Group justify="center" py={70}><Loader /><Text c="dimmed">Calculando indicadores da operação…</Text></Group>}
    {data && <>
      <SimpleGrid cols={{ base: 2, lg: 3, xl: 6 }}>{metrics.map((metric) => <div className={styles.metric} key={metric.label} style={{ "--accent": metric.color } as CSSProperties}><Text size="sm" c="dimmed">{metric.label}</Text><div className={styles.metricValue}>{metric.value}</div><Text size="xs" c="dimmed">{metric.detail}</Text></div>)}</SimpleGrid>
      {data.summary.longRunningTimers > 0 && <Alert color="orange" title="Confira os cronômetros em aberto">{data.summary.longRunningTimers} cronômetro(s) estão ativos há mais de 12 horas. O tempo continua entrando como provisório até a pausa; confira se foram esquecidos ligados.</Alert>}
      {!data.summary.seconds && <Group justify="space-between"><Text size="sm" c="dimmed">Sem tempo apontado neste período.</Text><Button variant="subtle" size="xs" onClick={onOpenActivities}>Abrir atividades</Button></Group>}
      <SimpleGrid cols={{ base: 1, lg: 2 }}><Paper withBorder p="lg" radius="lg"><Group justify="space-between"><div><Title order={4}>Evolução das horas</Title></div><Badge variant="light">{time(data.summary.seconds)}</Badge></Group><Trend data={data} /><Button size="compact-xs" variant="subtle" onClick={() => downloadCsv(`fortuno-evolucao-${data.period.from}.csv`, [["Data", "Tempo (segundos)", "Tempo apontado", "Atividades programadas"], ...data.daily.map((point) => [point.date, point.seconds, time(point.seconds, true), point.planned])])}>Baixar dados da evolução</Button></Paper>
      <Paper withBorder p="lg" radius="lg"><Title order={4}>Clientes que mais demandam tempo</Title>{data.byClient.filter((row) => row.seconds > 0).slice(0, 8).map((row, index) => <button type="button" key={row.id} className={styles.rank} onClick={() => drill("client", row.id, row.name)} aria-label={`Detalhar ${row.name}, ${time(row.seconds)}`}><span className={styles.rankPosition}>{String(index + 1).padStart(2, "0")}</span><span className={styles.rankBody}><Text size="sm" lineClamp={1}>{row.name}</Text><div className={styles.track}><div className={styles.bar} style={{ width: `${row.seconds / Math.max(1, data.byClient[0]?.seconds || 1) * 100}%` }} /></div></span><span className={styles.rankTime}>{time(row.seconds)}<Text size="xs" c="dimmed">{row.share.toFixed(1).replace(".", ",")}%</Text></span></button>)}{!data.summary.seconds && <Text ta="center" c="dimmed" py="xl">O ranking será exibido quando houver apontamentos.</Text>}</Paper></SimpleGrid>
      <Paper withBorder p="lg" radius="lg"><Group justify="space-between" mb="sm"><Title order={4}>Situação atual das atividades programadas</Title><Text size="sm" c="dimmed">Cobertura de apontamento: {data.summary.coverage === null ? "sem base" : `${data.summary.coverage.toFixed(1).replace(".", ",")}%`} · {data.summary.withoutTime} sem apontamento</Text></Group><div className={styles.statusTrack} role="img" aria-label={Object.entries(data.statusCounts).map(([status, count]) => `${statusNames[status]}: ${count}`).join(", ")}>{Object.entries(data.statusCounts).filter(([, count]) => count > 0).map(([status, count]) => <div key={status} style={{ width: `${count / Math.max(1, data.summary.planned) * 100}%`, background: statusHex[status] }} title={`${statusNames[status]}: ${count}`} />)}</div><Group gap="lg" mt="sm">{Object.entries(data.statusCounts).map(([status, count]) => <Badge key={status} color={statusColors[status]} variant="light">{statusNames[status]} · {count}</Badge>)}</Group></Paper>
      <Paper withBorder p="lg" radius="lg" className={styles.details} ref={details}><Stack><Group justify="space-between"><Title order={4}>Análise detalhada</Title>{inspect && <Group><Badge variant="light">{inspect.name}</Badge><Button size="compact-xs" variant="subtle" onClick={() => setInspect(null)}>Limpar detalhamento</Button></Group>}</Group><Tabs value={tab} onChange={(value) => { setTab(value); setPage(1); }} keepMounted={false}><Tabs.List><Tabs.Tab value="clients">Por cliente</Tabs.Tab><Tabs.Tab value="operators">Por operador</Tabs.Tab><Tabs.Tab value="activities">Atividades</Tabs.Tab><Tabs.Tab value="processes">Processos</Tabs.Tab><Tabs.Tab value="teams">Equipes</Tabs.Tab><Tabs.Tab value="clusters">Clusters</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="clients" pt="md"><GroupTable rows={data.byClient} label="Clientes" onInspect={(id) => drill("client", id, data.byClient.find((row) => row.id === id)?.name || "Cliente")} /></Tabs.Panel><Tabs.Panel value="operators" pt="md"><GroupTable rows={data.byOperator} label="Operadores" onInspect={(id) => drill("operator", id, data.byOperator.find((row) => row.id === id)?.name || "Operador")} /></Tabs.Panel><Tabs.Panel value="processes" pt="md"><GroupTable rows={data.byProcess} label="Processos" onInspect={(id) => drill("process", id, data.byProcess.find((row) => row.id === id)?.name || "Processo")} /></Tabs.Panel><Tabs.Panel value="teams" pt="md"><GroupTable rows={data.byTeam} label="Equipes" /></Tabs.Panel><Tabs.Panel value="clusters" pt="md"><GroupTable rows={data.byCluster} label="Clusters" /></Tabs.Panel>
      <Tabs.Panel value="activities" pt="md"><Stack><Group justify="space-between"><Text size="sm" c="dimmed">{activityRows.length} atividade(s), ordenadas pelo tempo no período.</Text><TextInput label="Buscar no detalhamento" placeholder="Atividade, cliente ou operador" value={activitySearch} onChange={(event) => { setActivitySearch(event.currentTarget.value); setPage(1); }} /></Group><ScrollArea><Table highlightOnHover miw={1060}><Table.Thead><Table.Tr>{["Atividade", "Cliente / processo", "Responsável", "Situação atual", "Tempo no período", "Quem apontou", ""].map((name, index) => <Table.Th key={`${name}-${index}`}>{name}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{activityRows.slice((visiblePage - 1) * 15, visiblePage * 15).map((row) => <Table.Tr key={row.id}><Table.Td><button type="button" className={styles.nameButton} onClick={() => onOpenActivity(row.id)}>{row.title}</button><Text size="xs" c="dimmed">{row.planned ? row.scheduledDate ? `Programada: ${dateLabel(row.scheduledDate)}` : "Sem data programada" : "Programada fora do período"}</Text></Table.Td><Table.Td><Text size="sm">{row.client}</Text><Text size="xs" c="dimmed">{row.process}</Text></Table.Td><Table.Td>{row.responsible}</Table.Td><Table.Td><Badge color={statusColors[row.status]} variant="light">{statusNames[row.status]}</Badge></Table.Td><Table.Td className={styles.numeric}><Text fw={750}>{time(row.seconds, true)}</Text>{row.runningSeconds > 0 && <Text size="xs" c="cyan">Inclui cronômetro ativo</Text>}</Table.Td><Table.Td>{row.operators.length ? row.operators.map((operator) => <Text key={operator.id} size="xs">{operator.name}: {time(operator.seconds, true)}</Text>) : <Text size="xs" c="dimmed">Sem apontamento no período</Text>}</Table.Td><Table.Td><Button size="compact-xs" variant="subtle" aria-label={`Abrir atividade ${row.title}`} onClick={() => onOpenActivity(row.id)}><IconArrowRight size={16} /></Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>{!activityRows.length && <Text ta="center" c="dimmed" py="xl">Nenhuma atividade neste detalhamento.</Text>}{activityRows.length > 15 && <Pagination total={Math.ceil(activityRows.length / 15)} value={visiblePage} onChange={setPage} size="sm" />}</Stack></Tabs.Panel></Tabs></Stack></Paper>
    </>}
  </Stack>;
}
