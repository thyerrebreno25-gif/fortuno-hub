"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Alert, Badge, Button, Checkbox, Group, Loader, Paper, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCalendarCheck, IconRefresh } from "@tabler/icons-react";
import { FilterPanel } from "@/components/filter-panel";
import { formatMeetingDate, jsonRequest, meetingRequest, type MeetingAction } from "./client";
import styles from "./meetings.module.css";
type DailyData = {actions: Array<MeetingAction & {originalDueAt: string | null; autoExtendedAt: string | null; meeting: {id: string; title: string; type: string}}>; total: number; summary: {pending: number; overdue: number; completed: number}; userId: string; manager: boolean; canEdit: boolean; canViewMeetings: boolean};
export function DailyActivitiesPage() {
  const [data, setData] = useState<DailyData | null>(null), [error, setError] = useState("");
  const [scope, setScope] = useState("mine"), [status, setStatus] = useState("pending"), [type, setType] = useState("all"), [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null), [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(async () => {
    const current = ++sequence.current;
    setLoading(true);
    try {
      const result = await meetingRequest<DailyData>(`/api/meetings/daily?${new URLSearchParams({scope, status, type, q: query, page: String(page)})}`);
      if (current === sequence.current) {setData(result); setNow(Date.now()); setError("");}
    } catch (cause) {if (current === sequence.current) setError(cause instanceof Error ? cause.message : "Não foi possível carregar.");}
    finally {if (current === sequence.current) setLoading(false);}
  }, [scope, status, type, query, page]);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 250);
    const refresh = () => {if (!document.hidden) void load();};
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener("focus", refresh);};
  }, [load]);
  async function toggle(item: DailyData["actions"][number], completed: boolean) {
    setBusy(item.id);
    try {
      await meetingRequest("/api/meetings/daily", jsonRequest("PATCH", {meetingId: item.meeting.id, id: item.id, revision: item.revision, completed}));
      window.dispatchEvent(new Event("fortuno:notifications-refresh"));
      window.dispatchEvent(new Event("fortuno:calendar-changed"));
      await load();
      notifications.show({color: "teal", message: completed ? "Atividade concluída. A reunião e a agenda também foram atualizadas." : "Atividade reaberta na reunião e na agenda."});
    } catch (cause) {notifications.show({color: "red", message: cause instanceof Error ? cause.message : "Falha ao atualizar."}); await load();}
    finally {setBusy(null);}
  }
  return <Stack gap="lg">
    <Group justify="space-between"><div><Group gap="xs"><IconCalendarCheck size={27}/><Title order={2}>Atividades Daily</Title></Group><Text c="dimmed" size="sm" mt={5}>Entregas das reuniões Daily e Semanal de squad, com conclusão sincronizada.</Text></div><Button variant="light" leftSection={<IconRefresh size={16}/>} loading={loading} onClick={() => void load()}>Atualizar</Button></Group>
    {error && <Alert color="red">{error}</Alert>}
    {!data && loading && <Loader/>}
    {data && <>
      <SimpleGrid cols={{base: 1, sm: 3}}>{[["Pendentes", data.summary.pending, "blue"], ["Em atraso", data.summary.overdue, "red"], ["Concluídas", data.summary.completed, "teal"]].map(([label, value, color]) => <Paper withBorder radius="md" p="md" key={label}><Text size="sm" c="dimmed">{label}</Text><Text size="30px" fw={800} c={String(color)}>{value}</Text></Paper>)}</SimpleGrid>
      <FilterPanel title="Filtros de atividades" activeCount={Number(scope !== "mine") + Number(status !== "pending") + Number(type !== "all") + Number(Boolean(query))}><SimpleGrid cols={{base: 1, sm: 2, lg: 4}}>
        {data.manager && <Select label="Responsabilidade" value={scope} allowDeselect={false} onChange={value => {setScope(value || "mine"); setPage(0);}} data={[{value: "mine", label: "Minhas atividades"}, {value: "all", label: "Toda a equipe"}]}/>}
        <Select label="Situação" value={status} allowDeselect={false} onChange={value => {setStatus(value || "pending"); setPage(0);}} data={[{value: "pending", label: "Pendentes"}, {value: "overdue", label: "Em atraso"}, {value: "completed", label: "Concluídas"}, {value: "all", label: "Todas"}]}/>
        <Select label="Tipo da reunião" value={type} allowDeselect={false} onChange={value => {setType(value || "all"); setPage(0);}} data={[{value: "all", label: "Daily e Semanal de squad"}, {value: "Daily", label: "Daily"}, {value: "Semanal de squad", label: "Semanal de squad"}]}/>
        <TextInput label="Buscar" placeholder="Atividade ou reunião" value={query} onChange={event => {setQuery(event.currentTarget.value); setPage(0);}}/>
      </SimpleGrid></FilterPanel>
      <Text size="xs" c="dimmed">{scope === "mine" ? "Minhas atividades" : "Toda a equipe"} · {data.total} resultado(s) · Daily: uma única prorrogação para o próximo dia útil, no mesmo horário. O gestor recebe um aviso no vencimento original.</Text>
      {!data.actions.length && <Paper p="xl" withBorder radius="lg"><Text ta="center" c="dimmed">Nenhuma atividade neste filtro. As entregas atribuídas nas reuniões aparecem aqui automaticamente.</Text></Paper>}
      {data.actions.map(item => {
        const overdue = !item.completedAt && +new Date(item.dueAt) < now;
        return <Paper key={item.id} p="md" radius="md" withBorder className={styles.task} data-overdue={overdue} data-completed={Boolean(item.completedAt)}>
          <Group justify="space-between" align="flex-start" wrap="wrap"><div style={{minWidth: 0, flex: "1 1 280px"}}><Group gap="xs" mb="xs"><Badge size="xs" variant="light">{item.meeting.type}</Badge><Badge size="xs" color={item.completedAt ? "teal" : overdue ? "red" : "blue"}>{item.completedAt ? "Concluída" : overdue ? "Em atraso" : "Pendente"}</Badge>{item.autoExtendedAt && <Badge size="xs" color="orange" variant="light">Prorrogação única utilizada</Badge>}</Group><Checkbox label={item.title} checked={Boolean(item.completedAt)} disabled={!!busy || !data.canEdit || (!data.manager && item.responsibleId !== data.userId)} onChange={event => void toggle(item, event.currentTarget.checked)}/>{item.description && <Text size="sm" mt="xs" className={styles.prose}>{item.description}</Text>}<Text size="xs" c="dimmed" mt="xs">{item.responsible.name || item.responsible.email} · Prazo: {formatMeetingDate(item.dueAt)}</Text>{item.originalDueAt && <Text size="xs" c="dimmed">Prazo original: {formatMeetingDate(item.originalDueAt)}</Text>}<Text size="xs" mt={5}>{item.meeting.title}</Text></div>{data.canViewMeetings && <Button component={Link} href={`/reunioes?meeting=${encodeURIComponent(item.meeting.id)}`} size="xs" variant="subtle">Ver na reunião</Button>}</Group>
        </Paper>;
      })}
      <Group justify="space-between"><Button variant="subtle" disabled={!page || loading} onClick={() => setPage(value => value - 1)}>Anterior</Button><Text size="sm">Página {page + 1} de {Math.max(1, Math.ceil(data.total / 30))}</Text><Button variant="subtle" disabled={(page + 1) * 30 >= data.total || loading} onClick={() => setPage(value => value + 1)}>Próxima</Button></Group>
    </>}
  </Stack>;
}
