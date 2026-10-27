"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, Menu, Modal, Paper, SegmentedControl, SimpleGrid, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { dayKey } from "./model";
import { formatMeetingDate, inputToIso, jsonRequest, localDateInput, meetingRequest } from "./client";
import styles from "./meetings.module.css";
import calendarStyles from "./calendar.module.css";
import { CalendarBoard, MiniCalendar } from "./calendar-board";
import { calendarDate, calendarRange, moveCalendar, type CalendarView } from "./calendar-layout";

type Event = { id: string; title: string; description: string; startsAt: string; endsAt: string; location: string; status: string; meetingId: string | null; actionItemId: string | null; revision: number; googleSyncStatus: string; syncError: string | null };
type External = { id: string; title: string; startsAt: string; endsAt: string; allDay: boolean; htmlLink?: string };
type AgendaData = { events: Event[]; external: External[]; pending: Array<{ id: string; title: string; dueAt: string; meetingId: string }>; truncated: boolean; connection: { status: string; lastError: string | null } | null; googleConfigured: boolean; googleError: string; permissions: { canCreate: boolean; canEdit: boolean } };
const blank = () => ({ title: "", description: "", location: "", startsAt: localDateInput(new Date()), endsAt: localDateInput(new Date(Date.now() + 3600000)) });
export function AgendaPage() {
  const [anchor, setAnchor] = useState(() => dayKey(new Date())), [view, setView] = useState<CalendarView>("week");
  const [showHub, setShowHub] = useState(true), [showGoogle, setShowGoogle] = useState(true);
  const [data, setData] = useState<AgendaData | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false), [selected, setSelected] = useState<Event | null>(null), [form, setForm] = useState(blank);
  const [quick, setQuick] = useState(false);
  const requestSequence = useRef(0);
  const range = useMemo(() => calendarRange(anchor, view), [anchor, view]);
  const load = useCallback(async (silent = false) => {
    const sequence = ++requestSequence.current;
    if (!silent) setLoading(true);
    try { const result = await meetingRequest<AgendaData>(`/api/calendar?${new URLSearchParams({ from: range.from, to: range.to })}`); if (sequence === requestSequence.current) { setData(result); setError(""); } }
    catch (error) { if (sequence === requestSequence.current) setError(error instanceof Error ? error.message : "Falha ao carregar agenda."); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [range]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  useEffect(() => {
    if (modal || busy) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [load, modal, busy]);
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
    setQuick(!event);
    setSelected(event || null);
    setForm(event ? { title: event.title, description: event.description, location: event.location, startsAt: localDateInput(event.startsAt), endsAt: localDateInput(event.endsAt) } : blank()); setModal(true);
  }
  const linked = Boolean(selected?.meetingId);
  const readonly = linked || !(selected ? data?.permissions.canEdit : data?.permissions.canCreate);
  function createAt(key: string, minutes = 9 * 60) {
    if (!data?.permissions.canCreate || busy) return;
    const start = new Date(`${key}T00:00:00-03:00`);
    start.setTime(start.getTime() + minutes * 60000);
    setSelected(null);
    setForm({ ...blank(), startsAt: localDateInput(start), endsAt: localDateInput(new Date(+start + 3600000)) });
    setQuick(true);
    setModal(true);
  }
  function createMenu() {
    return <Menu shadow="md" width={220} position="bottom-start"><Menu.Target><Button disabled={!data?.permissions.canCreate || busy}>+ Criar ▾</Button></Menu.Target><Menu.Dropdown><Menu.Item onClick={() => createAt(anchor)}>Evento</Menu.Item><Menu.Item component="a" href="/reunioes">Reunião com a equipe</Menu.Item></Menu.Dropdown></Menu>;
  }
  function saveEvent() {
    if (busy || readonly) return;
    void run(async () => {
      const startsAt = inputToIso(form.startsAt), endsAt = inputToIso(form.endsAt);
      if (form.title.trim().length < 2) throw new Error("Preencha um título com pelo menos 2 caracteres.");
      if (!(new Date(endsAt) > new Date(startsAt))) throw new Error("O término deve ser depois do início.");
      await meetingRequest("/api/calendar", jsonRequest(selected ? "PATCH" : "POST", { ...form, startsAt, endsAt, ...(selected ? { id: selected.id, revision: selected.revision } : {}) }));
      setModal(false);
      notifications.show({ color: "green", message: data?.connection?.status === "CONNECTED" ? "Evento salvo. A sincronização com o Google será feita automaticamente." : "Evento salvo na sua agenda do Fortuno Hub." });
      await load();
    });
  }
  const items = [...(data?.events || []).map((event) => ({ ...event, external: false, allDay: false })), ...(data?.external || []).map((event) => ({ ...event, external: true, status: "ACTIVE", meetingId: null, actionItemId: null, description: "", location: "", revision: 0, googleSyncStatus: "EXTERNAL", syncError: null }))].sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
  function eventButton(item: (typeof items)[number]) {
    const label = `${item.allDay ? "Dia todo" : new Date(item.startsAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} · ${item.title}`;
    return item.external ? <a key={`google:${item.id}`} className={styles.event} data-external="true" href="https://calendar.google.com/calendar/u/0/r" target="_blank" rel="noreferrer" title={label} aria-label={`Google Agenda: ${label}`}>{label} ↗</a> : <button key={item.id} className={styles.event} title={label} data-completed={item.status === "COMPLETED"} onClick={() => open(item)}>{label}</button>;
  }
  const today = dayKey(new Date());
  const visibleItems = items.filter((item) => item.external ? showGoogle : showHub);
  const periodLabel = view === "day" ? calendarDate(anchor).toLocaleDateString("pt-BR", { timeZone: "UTC", dateStyle: "long" }) : view === "week" ? `${calendarDate(range.days[0]).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "numeric", month: "short" })} – ${calendarDate(range.days.at(-1)!).toLocaleDateString("pt-BR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" })}` : calendarDate(anchor).toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });
  function selectDay(key: string) { setAnchor(key); setView("day"); }
  return <div className={styles.page}>
    <div className={styles.hero}><Group justify="space-between"><div><Text size="xs" fw={800} c="blue">COMPROMISSOS · METAS · PRAZOS</Text><Title order={2}>Minha Agenda</Title></div><Group><Button variant="default" component="a" href="/reunioes">Central de reuniões</Button>{createMenu()}</Group></Group></div>
    {error && <Alert color="red">{error}</Alert>}
    {!data && loading && <Loader />}
    {data && <>
      {data.pending.length > 0 && <Alert color="orange" title={`${data.pending.length} entregas precisam de atenção`}><Stack gap={6}>{data.pending.slice(0, 8).map((item) => <Text size="sm" key={item.id}><a href={`/reunioes?meeting=${encodeURIComponent(item.meetingId)}`}>{item.title}</a> · {formatMeetingDate(item.dueAt)} · {new Date(item.dueAt) < new Date() ? "Atrasada" : "Prazo próximo"}</Text>)}<Text size="xs">Os avisos permanecem enquanto a entrega não receber o check na reunião.</Text></Stack></Alert>}
      <div className={calendarStyles.workspace}>
        <aside className={calendarStyles.sidebar}>
          {createMenu()}
          <Text fw={650} size="sm" tt="capitalize">{calendarDate(anchor).toLocaleDateString("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" })}</Text>
          <MiniCalendar anchor={anchor} today={today} onDate={selectDay} />
          <Text size="xs" fw={700} c="dimmed">MINHAS AGENDAS</Text>
          <Checkbox label="Fortuno Hub" checked={showHub} onChange={(event) => setShowHub(event.currentTarget.checked)} />
          <Checkbox label="Google Agenda" color="green" checked={showGoogle} onChange={(event) => setShowGoogle(event.currentTarget.checked)} />
          <Text size="xs" c="dimmed">Reuniões e entregas são editadas na Central de Reuniões. Eventos externos abrem no Google.</Text>
          <Badge variant="light" color={data.connection?.status === "CONNECTED" ? "green" : "gray"}>{data.connection?.status === "CONNECTED" ? "Google conectado" : "Agenda interna"}</Badge>
        </aside>
        <div className={calendarStyles.main}>
          <div className={calendarStyles.toolbar}>
            <Group gap="xs"><Button size="xs" variant="default" onClick={() => setAnchor(dayKey(new Date()))}>Hoje</Button><Button size="xs" variant="subtle" aria-label="Período anterior" onClick={() => setAnchor(moveCalendar(anchor, view, -1))}>‹</Button><Button size="xs" variant="subtle" aria-label="Próximo período" onClick={() => setAnchor(moveCalendar(anchor, view, 1))}>›</Button><h3 className={calendarStyles.period} aria-live="polite">{periodLabel}</h3></Group>
            <Group gap="xs"><SegmentedControl aria-label="Visualização da agenda" value={view} onChange={(value) => setView(value as CalendarView)} data={[{ value: "day", label: "Dia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mês" }, { value: "list", label: "Lista" }]} /><Button size="xs" variant="default" loading={loading} onClick={() => void load()}>Atualizar</Button></Group>
          </div>
          <Group px="md" py="xs" gap="sm"><TextInput type="date" size="xs" aria-label="Ir para uma data" value={anchor} onChange={(event) => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.currentTarget.value)) setAnchor(event.currentTarget.value); }} /><Checkbox size="xs" label="Fortuno" checked={showHub} onChange={(event) => setShowHub(event.currentTarget.checked)} /><Checkbox size="xs" color="green" label="Google" checked={showGoogle} onChange={(event) => setShowGoogle(event.currentTarget.checked)} /><Text size="xs" c="dimmed">Horário de Brasília</Text></Group>
          {data.truncated && <Alert color="orange">Exibindo os primeiros 1.000 compromissos deste período.</Alert>}
          {loading ? <Group justify="center" p="xl"><Loader size="sm" /><Text size="sm" c="dimmed">Carregando compromissos…</Text></Group> : <CalendarBoard anchor={anchor} view={view} today={today} items={visibleItems} renderItem={eventButton} onDate={selectDay} onCreate={data.permissions.canCreate && !busy ? createAt : undefined} />}
        </div>
      </div>
      <Paper withBorder radius="lg" p="lg"><Stack><Group justify="space-between"><div><Title order={4}>Google Agenda</Title><Text size="sm" c="dimmed">A conexão é individual. O Hub envia seus compromissos e permite consultar os eventos externos da agenda principal.</Text></div><Badge color={data.connection?.status === "CONNECTED" ? "green" : "gray"}>{data.connection?.status === "CONNECTED" ? "Conectado" : data.googleConfigured ? "Não conectado" : "Configuração pendente"}</Badge></Group>
        {!data.googleConfigured && <Alert color="blue">A agenda interna já funciona. A conexão com o Google será liberada após configurar as credenciais OAuth da aplicação.</Alert>}
        {(data.googleError || data.connection?.lastError) && <Alert color="orange">{data.googleError || data.connection?.lastError}</Alert>}
        <Group>{data.connection?.status === "CONNECTED" ? <><Button loading={busy} disabled={!data.permissions.canEdit} onClick={() => void run(async () => { const result = await meetingRequest<{ synced: number }>("/api/calendar/google", { method: "PATCH" }); notifications.show({ message: `${result.synced} compromissos sincronizados nesta tentativa.` }); await load(); })}>Sincronizar agora</Button><Button variant="subtle" color="red" disabled={busy || !data.permissions.canEdit} onClick={() => { if (window.confirm("Desconectar sua conta? Os eventos já enviados permanecem no Google.")) void run(async () => { await meetingRequest("/api/calendar/google", { method: "DELETE" }); await load(); }); }}>Desconectar</Button></> : <Button loading={busy} disabled={!data.googleConfigured || !data.permissions.canEdit} onClick={() => void run(async () => { const result = await meetingRequest<{ url: string }>("/api/calendar/google", { method: "POST" }); window.location.assign(result.url); })}>Autorizar meu Google Agenda</Button>}</Group>
        <Text size="xs" c="dimmed">Eventos do Hub são sincronizados após alterações. O resumo de lembretes por e-mail é diário; no Hub, pendências também aparecem ao abrir a agenda e no sino de notificações.</Text>
      </Stack></Paper>
    </>}
    <Modal closeButtonProps={{ "aria-label": "Fechar evento" }} opened={modal} onClose={() => !busy && setModal(false)} size={quick ? 460 : "md"} centered title={quick ? "Novo evento" : linked ? "Compromisso vinculado" : selected ? "Editar compromisso" : "Novo compromisso"}><Stack>
      {quick ? <>
        <TextInput className={calendarStyles.quickTitle} aria-label="Título do evento" placeholder="Adicionar título" data-autofocus required maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
        <Group><Badge size="lg" variant="filled">Evento</Badge><Text size="xs" c="dimmed">Minha agenda · Fortuno Hub</Text></Group>
        <div className={calendarStyles.quickDate}><SimpleGrid cols={2}><TextInput type="datetime-local" label="Início · Brasília" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.currentTarget.value })} /><TextInput type="datetime-local" label="Término · Brasília" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.currentTarget.value })} /></SimpleGrid></div>
        <TextInput label="Local" placeholder="Adicionar local ou link da chamada" value={form.location} onChange={(event) => setForm({ ...form, location: event.currentTarget.value })} />
        <Textarea label="Descrição" placeholder="Adicionar descrição" autosize minRows={2} value={form.description} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} />
        <Text size="xs" c="dimmed">{data?.connection?.status === "CONNECTED" ? "Será sincronizado com sua agenda principal do Google." : "Será salvo na sua agenda do Fortuno Hub."}</Text>
        <Group justify="flex-end"><Button variant="subtle" disabled={busy} onClick={() => setQuick(false)}>Mais opções</Button><Button loading={busy} onClick={saveEvent}>Salvar</Button></Group>
      </> : <>
      <TextInput label="Título" required disabled={readonly} maxLength={300} value={form.title} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput type="datetime-local" label="Início · Brasília" required disabled={readonly} value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.currentTarget.value })} /><TextInput type="datetime-local" label="Término · Brasília" required disabled={readonly} value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.currentTarget.value })} /></SimpleGrid>
      <TextInput label="Local" disabled={readonly} value={form.location} onChange={(event) => setForm({ ...form, location: event.currentTarget.value })} /><Textarea label="Descrição" disabled={readonly} value={form.description} autosize minRows={3} onChange={(event) => setForm({ ...form, description: event.currentTarget.value })} />
      {selected && <><Badge color={selected.googleSyncStatus === "SYNCED" ? "green" : "orange"}>{selected.googleSyncStatus === "SYNCED" ? "Sincronizado com Google" : "Aguardando conexão / sincronização"}</Badge>{selected.syncError && <Alert color="orange">{selected.syncError}</Alert>}</>}
      {linked ? <Button component="a" href={`/reunioes?meeting=${encodeURIComponent(selected!.meetingId!)}`}>Abrir reunião e checklist</Button> : <Group><Button loading={busy} disabled={readonly || (!selected && !data?.permissions.canCreate)} onClick={saveEvent}>Salvar compromisso</Button>{selected && <Button color="red" variant="subtle" disabled={busy || readonly} onClick={() => { if (window.confirm("Cancelar este compromisso?")) void run(async () => { await meetingRequest("/api/calendar", jsonRequest("PATCH", { id: selected.id, revision: selected.revision, cancelled: true })); setModal(false); await load(); }); }}>Cancelar evento</Button>}</Group>}
    </>}
    </Stack></Modal>
  </div>;
}
