"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, ScrollArea, SegmentedControl, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { dayKey } from "./model";
import { formatMeetingDate, inputToIso, jsonRequest, localDateInput, meetingRequest } from "./client";
import styles from "./meetings.module.css";

type Event = { id: string; title: string; description: string; startsAt: string; endsAt: string; location: string; status: string; meetingId: string | null; actionItemId: string | null; revision: number; googleSyncStatus: string; syncError: string | null };
type External = { id: string; title: string; startsAt: string; endsAt: string; allDay: boolean; htmlLink?: string };
type AgendaData = { events: Event[]; external: External[]; pending: Array<{ id: string; title: string; dueAt: string; meetingId: string }>; truncated: boolean; connection: { status: string; lastError: string | null } | null; googleConfigured: boolean; googleError: string; permissions: { canCreate: boolean; canEdit: boolean } };
const blank = () => ({ title: "", description: "", location: "", startsAt: localDateInput(new Date()), endsAt: localDateInput(new Date(Date.now() + 3600000)) });
export function AgendaPage() {
  const [month, setMonth] = useState(() => dayKey(new Date()).slice(0, 7)), [view, setView] = useState("month");
  const [data, setData] = useState<AgendaData | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false), [selected, setSelected] = useState<Event | null>(null), [form, setForm] = useState(blank);
  const requestSequence = useRef(0);
  const range = useMemo(() => {
    const [year, number] = month.split("-").map(Number);
    const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
    return { from: `${month}-01T00:00:00-03:00`, to: `${next}-01T00:00:00-03:00`, days: new Date(Date.UTC(year, number, 0)).getUTCDate(), offset: new Date(`${month}-01T12:00:00Z`).getUTCDay() };
  }, [month]);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try { const result = await meetingRequest<AgendaData>(`/api/calendar?${new URLSearchParams({ from: range.from, to: range.to })}`); if (sequence === requestSequence.current) { setData(result); setError(""); } }
    catch (error) { if (sequence === requestSequence.current) setError(error instanceof Error ? error.message : "Falha ao carregar agenda."); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [range]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const message = url.searchParams.get("google_error");
    if (message) notifications.show({ color: "orange", title: "Google Agenda", message });
    if (url.searchParams.get("google") === "connected") notifications.show({ color: "green", message: "Google Agenda conectado. Seus eventos serão sincronizados." });
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (error) { notifications.show({ color: "red", message: error instanceof Error ? error.message : "Falha na ação." }); }
    finally { setBusy(false); }
  }
  function open(event?: Event) {
    setSelected(event || null);
    setForm(event ? { title: event.title, description: event.description, location: event.location, startsAt: localDateInput(event.startsAt), endsAt: localDateInput(event.endsAt) } : blank()); setModal(true);
  }
  const linked = Boolean(selected?.meetingId);
  const readonly = linked || !data?.permissions.canEdit;
  const items = [...(data?.events || []).map((event) => ({ ...event, external: false, allDay: false })), ...(data?.external || []).map((event) => ({ ...event, external: true, status: "ACTIVE", meetingId: null, actionItemId: null, description: "", location: "", revision: 0, googleSyncStatus: "EXTERNAL", syncError: null }))].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  function eventButton(item: (typeof items)[number]) {
    const label = `${item.allDay ? "Dia todo" : new Date(item.startsAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} · ${item.title}`;
    return item.external ? <a key={`google:${item.id}`} className={styles.event} data-external="true" href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer" aria-label={`Google Agenda: ${label}`}>{label} ↗</a> : <button key={item.id} className={styles.event} data-completed={item.status === "COMPLETED"} onClick={() => open(item)}>{label}</button>;
  }
  function moveMonth(amount: number) { const [year, value] = month.split("-").map(Number); const next = new Date(Date.UTC(year, value - 1 + amount, 1)); setMonth(next.toISOString().slice(0, 7)); }
  return <div className={styles.page}>
    <div className={styles.hero}><Group justify="space-between"><div><Text size="xs" fw={800} c="blue">COMPROMISSOS · METAS · PRAZOS</Text><Title order={2}>Minha Agenda</Title><Text size="sm" c="dimmed">Reuniões e entregas da equipe entram aqui automaticamente. Horários de Brasília.</Text></div><Group><Button variant="default" component="a" href="/reunioes">Central de reuniões</Button><Button disabled={!data?.permissions.canCreate || busy} onClick={() => open()}>Novo compromisso</Button></Group></Group></div>
    {error && <Alert color="red">{error}</Alert>}
    {!data && loading && <Loader />}
    {data && <>
      {data.pending.length > 0 && <Alert color="orange" title={`${data.pending.length} entregas precisam de atenção`}><Stack gap={6}>{data.pending.slice(0, 8).map((item) => <Text size="sm" key={item.id}><a href={`/reunioes?meeting=${encodeURIComponent(item.meetingId)}`}>{item.title}</a> · {formatMeetingDate(item.dueAt)} · {new Date(item.dueAt) < new Date() ? "Atrasada" : "Prazo próximo"}</Text>)}<Text size="xs">Os avisos permanecem enquanto a entrega não receber o check na reunião.</Text></Stack></Alert>}
      <Paper withBorder radius="lg" p="lg"><Stack>
        <Group justify="space-between"><Group><Button size="xs" variant="default" aria-label="Mês anterior" onClick={() => moveMonth(-1)}>‹</Button><TextInput type="month" aria-label="Mês da agenda" value={month} onChange={(event) => { if (/^\d{4}-\d{2}$/.test(event.currentTarget.value)) setMonth(event.currentTarget.value); }} /><Button size="xs" variant="default" aria-label="Próximo mês" onClick={() => moveMonth(1)}>›</Button><Button size="xs" variant="subtle" onClick={() => setMonth(dayKey(new Date()).slice(0, 7))}>Hoje</Button></Group><Group><SegmentedControl value={view} onChange={setView} data={[{ value: "month", label: "Mês" }, { value: "list", label: "Lista" }]} /><Button size="xs" variant="default" loading={loading} onClick={() => void load()}>Atualizar</Button></Group></Group>
        <Group gap="xs"><Badge variant="light">Fortuno Hub</Badge><Badge color="green" variant="light">Google · consulta externa</Badge><Text size="xs" c="dimmed">Para alterar uma entrega ou reunião, abra sua origem. Eventos externos são editados no Google.</Text></Group>
        {data.truncated && <Alert color="orange">Exibindo os primeiros 1.000 compromissos deste período.</Alert>}
        {view === "month" ? <ScrollArea><div className={styles.calendar}>
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label) => <div className={styles.dayHeading} key={label}>{label}</div>)}
          {Array.from({ length: range.offset }, (_, index) => <div key={`blank:${index}`} className={styles.day} />)}
          {Array.from({ length: range.days }, (_, index) => { const key = `${month}-${String(index + 1).padStart(2, "0")}`; const start = +new Date(`${key}T00:00:00-03:00`), end = start + 86400000; const events = items.filter((item) => +new Date(item.startsAt) < end && +new Date(item.endsAt) > start); return <div key={key} className={styles.day} data-today={dayKey(new Date()) === key}><Text size="xs" fw={700}>{index + 1}</Text>{events.map(eventButton)}</div>; })}
        </div></ScrollArea> : <Stack>{!items.length && <Text c="dimmed" py="lg">Nenhum compromisso neste mês.</Text>}{items.map((item) => <Paper key={`${item.external ? "google" : "hub"}:${item.id}`} withBorder p="sm" radius="md"><Text size="xs" c="dimmed">{item.allDay ? dayKey(new Date(item.startsAt)) : formatMeetingDate(item.startsAt)}</Text>{eventButton(item)}</Paper>)}</Stack>}
      </Stack></Paper>
      <Paper withBorder radius="lg" p="lg"><Stack><Group justify="space-between"><div><Title order={4}>Google Agenda</Title><Text size="sm" c="dimmed">A conexão é individual. O Hub envia seus compromissos e permite consultar os eventos externos da agenda principal.</Text></div><Badge color={data.connection?.status === "CONNECTED" ? "green" : "gray"}>{data.connection?.status === "CONNECTED" ? "Conectado" : data.googleConfigured ? "Não conectado" : "Configuração pendente"}</Badge></Group>
        {!data.googleConfigured && <Alert color="blue">A agenda interna já funciona. A conexão com o Google será liberada após configurar as credenciais OAuth da aplicação.</Alert>}
        {(data.googleError || data.connection?.lastError) && <Alert color="orange">{data.googleError || data.connection?.lastError}</Alert>}
        <Group>{data.connection?.status === "CONNECTED" ? <><Button loading={busy} disabled={!data.permissions.canEdit} onClick={() => void run(async () => { const result = await meetingRequest<{ synced: number }>("/api/calendar/google", { method: "PATCH" }); notifications.show({ message: `${result.synced} compromissos sincronizados nesta tentativa.` }); await load(); })}>Sincronizar agora</Button><Button variant="subtle" color="red" disabled={busy || !data.permissions.canEdit} onClick={() => { if (window.confirm("Desconectar sua conta? Os eventos já enviados permanecem no Google.")) void run(async () => { await meetingRequest("/api/calendar/google", { method: "DELETE" }); await load(); }); }}>Desconectar</Button></> : <Button loading={busy} disabled={!data.googleConfigured || !data.permissions.canEdit} onClick={() => void run(async () => { const result = await meetingRequest<{ url: string }>("/api/calendar/google", { method: "POST" }); window.location.assign(result.url); })}>Autorizar meu Google Agenda</Button>}</Group>
        <Text size="xs" c="dimmed">Eventos do Hub são sincronizados após alterações. O resumo de lembretes por e-mail é diário; no Hub, pendências também aparecem ao abrir a agenda e no sino de notificações.</Text>
      </Stack></Paper>
    </>}
    <Modal opened={modal} onClose={() => !busy && setModal(false)} title={linked ? "Compromisso vinculado" : selected ? "Editar compromisso" : "Novo compromisso"}><Stack>
      <TextInput label="Título" required disabled={readonly} maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput type="datetime-local" label="Início · Brasília" required disabled={readonly} value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.currentTarget.value })} /><TextInput type="datetime-local" label="Término · Brasília" required disabled={readonly} value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.currentTarget.value })} /></SimpleGrid>
      <TextInput label="Local" disabled={readonly} value={form.location} onChange={(event) => setForm({ ...form, location: event.currentTarget.value })} /><Textarea label="Descrição" disabled={readonly} value={form.description} autosize minRows={3} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} />
      {selected && <><Badge color={selected.googleSyncStatus === "SYNCED" ? "green" : "orange"}>{selected.googleSyncStatus === "SYNCED" ? "Sincronizado com Google" : "Aguardando conexão / sincronização"}</Badge>{selected.syncError && <Alert color="orange">{selected.syncError}</Alert>}</>}
      {linked ? <Button component="a" href={`/reunioes?meeting=${encodeURIComponent(selected!.meetingId!)}`}>Abrir reunião e checklist</Button> : <Group><Button loading={busy} disabled={readonly || (!selected && !data?.permissions.canCreate)} onClick={() => void run(async () => { await meetingRequest("/api/calendar", jsonRequest(selected ? "PATCH" : "POST", { ...form, startsAt: inputToIso(form.startsAt), endsAt: inputToIso(form.endsAt), ...(selected ? { id: selected.id, revision: selected.revision } : {}) })); setModal(false); await load(); })}>Salvar compromisso</Button>{selected && <Button color="red" variant="subtle" disabled={busy || readonly} onClick={() => { if (window.confirm("Cancelar este compromisso?")) void run(async () => { await meetingRequest("/api/calendar", jsonRequest("PATCH", { id: selected.id, revision: selected.revision, cancelled: true })); setModal(false); await load(); }); }}>Cancelar evento</Button>}</Group>}
    </Stack></Modal>
  </div>;
}
