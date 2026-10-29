"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Autocomplete, Badge, Button, Checkbox, Group, Loader, Modal, MultiSelect, Paper, Tabs, Select, SimpleGrid, Stack, TagsInput, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCalendar, IconPlus, IconRefresh } from "@tabler/icons-react";
import { MeetingChecklist } from "./checklist";
import { RecordingCapture } from "./recording-capture";
import { meetingTypes } from "./model";
import { formatMeetingDate, inputToIso, jsonRequest, localDateInput, meetingRequest, meetingStatus, type Meeting, type MeetingAction, type MeetingOptions } from "./client";
import styles from "./meetings.module.css";

type Summary = Pick<Meeting, "id" | "title" | "type" | "startsAt" | "status"> & { _count: { participants: number; actions: number }; actions: Array<{ completedAt: string | null }> };
const emptyForm = () => ({ title: "", type: "Alinhamento operacional (equipe)", externalEmails: [] as string[], generateMeet: false, startsAt: localDateInput(new Date()), endsAt: localDateInput(new Date(Date.now() + 3600000)), agenda: "", notes: "", location: "", status: "SCHEDULED", participantIds: [] as string[] });
export function MeetingsPage() {
  const [options, setOptions] = useState<MeetingOptions | null>(null), [meetings, setMeetings] = useState<Summary[]>([]), [meeting, setMeeting] = useState<Meeting | null>(null);
  const [canManage, setCanManage] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [q, setQ] = useState(""), [query, setQuery] = useState(""), [page, setPage] = useState(0), [hasMore, setHasMore] = useState(false);
  const [modal, setModal] = useState(false), [editing, setEditing] = useState(false), [form, setForm] = useState(emptyForm);
  const [actionModal, setActionModal] = useState(false), [editingAction, setEditingAction] = useState<MeetingAction | null>(null);
  const [task, setTask] = useState(() => ({ title: "", description: "", responsibleId: "", dueAt: localDateInput(new Date(Date.now() + 86400000)) }));
  const [note, setNote] = useState("");
  const report = (error: unknown) => notifications.show({ color: "red", title: "Central de reuniões", message: error instanceof Error ? error.message : "Falha ao concluir a ação." });
  const loadList = useCallback(async () => {
    const result = await meetingRequest<{ meetings: Summary[]; hasMore: boolean }>(`/api/meetings?page=${page}&q=${encodeURIComponent(query)}`);
    setMeetings(result.meetings); setHasMore(result.hasMore);
  }, [page, query]);
  const openMeeting = useCallback(async (id: string) => {
    const result = await meetingRequest<{ meeting: Meeting; canManage: boolean }>(`/api/meetings?id=${encodeURIComponent(id)}`);
    setMeeting(result.meeting); setCanManage(result.canManage);
    window.history.replaceState(null, "", `/reunioes?meeting=${encodeURIComponent(id)}`);
  }, []);
  useEffect(() => {
    let active = true;
    meetingRequest<MeetingOptions>("/api/meetings?view=options").then((result) => { if (active) setOptions(result); }).catch((error) => { if (active) setError(error.message); });
    const id = new URLSearchParams(window.location.search).get("meeting");
    if (id) void Promise.resolve().then(() => openMeeting(id)).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [openMeeting]);
  useEffect(() => { void Promise.resolve().then(loadList).catch((error) => setError(error.message)); }, [loadList]);
  useEffect(() => {
    if (!meeting || (!(meeting.generateMeet && !meeting.meetLink) && !meeting.recordings.some((item) => item.status === "TRANSCRIBING" || item.status === "READY" && options?.transcriptionConfigured))) return;
    const timer = setInterval(() => { void openMeeting(meeting.id).catch(() => {}); }, 10000);
    return () => clearInterval(timer);
  }, [meeting, openMeeting, options?.transcriptionConfigured]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  function showForm(source?: Meeting, next = false) {
    setEditing(Boolean(source) && !next);
    const offset = next ? (source?.type === "Daily" ? 86400000 : 7 * 86400000) : 0;
    setForm(source ? { title: source.title, type: source.type, externalEmails: source.externalEmails || [], generateMeet: source.generateMeet || false, startsAt: localDateInput(new Date(+new Date(source.startsAt) + offset)), endsAt: localDateInput(new Date(+new Date(source.endsAt) + offset)), agenda: source.agenda, notes: next ? "" : source.notes, status: next ? "SCHEDULED" : source.status, location: source.location, participantIds: source.participants.map((item) => item.userId) } : { ...emptyForm(), generateMeet: Boolean(options?.googleConnected), participantIds: options ? [options.userId] : [] });
    setModal(true);
  }
  function showTask(item?: MeetingAction, responsibleId?: string) {
    setEditingAction(item || null);
    setTask(item ? { title: item.title, description: item.description, responsibleId: item.responsibleId, dueAt: localDateInput(item.dueAt) } : { title: "", description: "", responsibleId: responsibleId || (meeting?.participants.some(item => item.userId === options?.userId) ? options?.userId : meeting?.participants[0]?.userId) || "", dueAt: localDateInput(new Date(Date.now() + 86400000)) });
    setActionModal(true);
  }
  const editable = Boolean(options?.permissions.canEdit);
  return <div className={styles.page}>
    <div className={styles.hero}><Group justify="space-between"><div><Title order={2}>Central de Reuniões</Title></div><Group><Button variant="default" component="a" href="/agenda" leftSection={<IconCalendar size={16} />}>Minha agenda</Button><Button leftSection={<IconPlus size={16} />} disabled={!options?.permissions.canCreate || busy} onClick={() => showForm()}>Criar reunião</Button></Group></Group></div>
    {error && <Alert color="red" withCloseButton onClose={() => setError("")}>{error}</Alert>}
    {!options && !error && <Loader />}
    {options && <div className={styles.layout}>
      <Stack gap="sm"><Group wrap="nowrap"><TextInput aria-label="Buscar reuniões" placeholder="Buscar reunião ou tipo" value={q} onChange={(event) => setQ(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { setPage(0); setQuery(q); } }} /><Button variant="light" onClick={() => { setPage(0); setQuery(q); }}>Buscar</Button></Group>
        <div className={styles.list}>{!meetings.length && <Paper p="md" withBorder><Text c="dimmed" size="sm">Nenhuma reunião neste filtro. Crie a primeira para organizar as entregas do squad.</Text></Paper>}{meetings.map((item) => <button key={item.id} className={styles.meetingButton} aria-pressed={meeting?.id === item.id} disabled={busy} onClick={() => void run(() => openMeeting(item.id))}><Group justify="space-between"><Badge size="xs" variant="light">{item.type}</Badge><Badge size="xs" color={item.status === "CANCELLED" ? "gray" : item.status === "COMPLETED" ? "green" : "blue"}>{meetingStatus[item.status]}</Badge></Group><Text fw={750} size="sm">{item.title}</Text><Text size="xs" c="dimmed">{formatMeetingDate(item.startsAt)}</Text><Text size="xs">{item._count.participants} participantes · {item.actions.filter((action) => action.completedAt).length}/{item._count.actions} entregas</Text></button>)}</div>
        <Group justify="space-between"><Button size="xs" variant="subtle" disabled={!page || busy} onClick={() => setPage((value) => value - 1)}>Anterior</Button><Text size="xs">Página {page + 1}</Text><Button size="xs" variant="subtle" disabled={!hasMore || busy} onClick={() => setPage((value) => value + 1)}>Próxima</Button></Group>
      </Stack>
      {!meeting ? <Paper withBorder p="xl" radius="lg"><Stack align="center" py={50}><IconCalendar size={42} /><Title order={3}>Um espaço para cada alinhamento</Title><Text c="dimmed" ta="center">Selecione uma reunião para consultar a pauta, registrar notas e acompanhar o checklist de cada colaborador.</Text></Stack></Paper> : <Stack>
        <Paper withBorder radius="lg" p="lg"><Stack>
          <Group justify="space-between"><div><Badge variant="light">{meeting.type}</Badge><Title order={3} mt="xs">{meeting.title}</Title><Text size="sm" c="dimmed">{formatMeetingDate(meeting.startsAt)} até {formatMeetingDate(meeting.endsAt)} · Horário de Brasília</Text></div><Button size="xs" variant="subtle" leftSection={<IconRefresh size={14} />} disabled={busy} onClick={() => void run(() => openMeeting(meeting.id))}>Atualizar</Button></Group>
          <Group gap="xs"><Badge color={meeting.status === "CANCELLED" ? "gray" : "blue"}>{meetingStatus[meeting.status]}</Badge>{meeting.participants.map(({ user }) => <Badge key={user.id} variant="outline" color="gray">{user.name || user.email}</Badge>)}</Group>
          {meeting.meetLink && <Button component="a" href={meeting.meetLink} target="_blank" rel="noreferrer" w="fit-content">Entrar no Google Meet</Button>}
          {meeting.integration?.syncError && <Alert color="orange">{meeting.integration.syncError}</Alert>}
          {meeting.generateMeet && !meeting.meetLink && <Text size="sm" c="dimmed">Link do Meet pendente. Confira a conexão Google do organizador e clique em Atualizar.</Text>}
          {meeting.externalEmails?.length > 0 && <Text size="sm">Convidados externos: {meeting.externalEmails.join(", ")}</Text>}
          {meeting.location && <Text size="sm" className={styles.prose}>Local / link: {meeting.location}</Text>}
          <div><Text fw={700} size="sm">Pauta</Text><Text size="sm" className={styles.prose} c={meeting.agenda ? undefined : "dimmed"}>{meeting.agenda || "Nenhuma pauta registrada."}</Text></div>
          {meeting.notes && <div><Text fw={700} size="sm">Ata / notas gerais</Text><Text size="sm" className={styles.prose}>{meeting.notes}</Text></div>}
          <Group>{canManage && editable && <Button size="xs" variant="light" disabled={busy} onClick={() => showForm(meeting)}>Editar reunião / ata</Button>}{options.permissions.canCreate && <Button size="xs" variant="default" disabled={busy} onClick={() => showForm(meeting, true)}>Preparar próxima reunião</Button>}</Group>
          {!options.remindersConfigured && <Alert color="orange">O resumo diário por e-mail aguarda configuração do agendador. Os avisos de pendências já aparecem na agenda e nas notificações do Hub.</Alert>}
          <Text size="xs" c="dimmed">Os convites aparecem no Fortuno Hub{options.emailConfigured ? " e são enviados por e-mail." : ". O envio por e-mail aguarda configuração."} Entregas pendentes continuam sendo lembradas, mesmo depois de realizar a reunião.</Text>
        </Stack></Paper>
        <MeetingChecklist key={meeting.id} meeting={meeting} userId={options.userId} canManage={canManage} editable={editable} busy={busy} onAdd={responsibleId => showTask(undefined, responsibleId)} onEdit={showTask} onToggle={(item, completed) => void run(async () => { await meetingRequest("/api/meetings/actions", jsonRequest("PATCH", { id: item.id, meetingId: meeting.id, revision: item.revision, completed })); await openMeeting(meeting.id); await loadList(); })} onDelete={item => { if (window.confirm("Excluir esta tarefa e cancelar o compromisso vinculado?")) void run(async () => { await meetingRequest("/api/meetings/actions", jsonRequest("DELETE", { id: item.id, meetingId: meeting.id, revision: item.revision })); await openMeeting(meeting.id); await loadList(); }); }} />
        <Tabs defaultValue="notes"><Tabs.List><Tabs.Tab value="notes">Notas da equipe</Tabs.Tab><Tabs.Tab value="recordings">Gravações e transcrições</Tabs.Tab></Tabs.List><Tabs.Panel value="notes" pt="md"><Paper withBorder radius="lg" p="lg"><Stack><Title order={4}>Notas da equipe</Title>{meeting.contributions.map((item) => <div key={item.id}><Text size="xs" fw={700}>{item.author.name || item.author.email} · {formatMeetingDate(item.createdAt)}</Text><Text size="sm" className={styles.prose}>{item.body}</Text></div>)}{editable && <><Textarea label="Adicionar uma nota" value={note} maxLength={10000} autosize minRows={2} onChange={(event) => setNote(event.currentTarget.value)} /><Button size="xs" w="fit-content" disabled={busy || !note.trim()} onClick={() => void run(async () => { await meetingRequest("/api/meetings/notes", jsonRequest("POST", { meetingId: meeting.id, body: note })); setNote(""); await openMeeting(meeting.id); })}>Registrar nota</Button></>}</Stack></Paper>
        </Tabs.Panel><Tabs.Panel value="recordings" pt="md">
        {editable && <RecordingCapture key={meeting.id} meetingId={meeting.id} configured={options.recordingConfigured} onSaved={() => void openMeeting(meeting.id).catch(report)} />}
        <Paper withBorder radius="lg" p="lg"><Stack><Title order={4}>Gravações e transcrições</Title><Text size="xs" c="dimmed">A transcrição pode conter erros. Revise o texto antes de usá-lo na ata. {options.transcriptionConfigured ? "" : "A transcrição automática aguarda configuração da API OpenAI."}</Text>{!meeting.recordings.length && <Text size="sm" c="dimmed">Nenhum áudio anexado a esta reunião.</Text>}{meeting.recordings.map((item) => <Stack key={item.id} gap="xs"><Group justify="space-between"><Text fw={700} size="sm">{item.name}</Text><Badge>{({ UPLOADING: "Envio pendente", READY: "Áudio salvo", TRANSCRIBING: "Transcrevendo", DONE: "Transcrita", FAILED: "Revisar transcrição" } as Record<string, string>)[item.status]}</Badge></Group>{item.status !== "UPLOADING" && <audio controls preload="none" src={`/api/meetings/recordings?id=${encodeURIComponent(item.id)}`} />}{item.error && <Alert color="orange">{item.error}</Alert>}{item.transcript && <Textarea label="Transcrição" value={item.transcript} readOnly autosize minRows={4} maxRows={14} />}{editable && options.transcriptionConfigured && ["READY", "FAILED", "TRANSCRIBING"].includes(item.status) && <Button size="xs" variant="light" w="fit-content" disabled={busy} onClick={() => void run(async () => { await meetingRequest("/api/meetings/recordings", jsonRequest("PATCH", { id: item.id, retry: true })); notifications.show({ message: "Solicitação de transcrição enviada. Áudios já em processamento não são duplicados." }); await openMeeting(meeting.id); })}>Tentar transcrição</Button>}</Stack>)}</Stack></Paper>
        </Tabs.Panel></Tabs>
      </Stack>}
    </div>}
    <Modal opened={modal} onClose={() => !busy && setModal(false)} title={editing ? "Editar reunião" : "Criar reunião"} size="lg"><Stack>
      <TextInput label="Título" required value={form.title} maxLength={180} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
      <Autocomplete label="Tipo de reunião" data={meetingTypes} limit={20} comboboxProps={{ withinPortal: false }} description="Escolha uma sugestão ou escreva outro tipo." value={form.type} maxLength={100} onChange={(type) => setForm({ ...form, type })} />
      <SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput type="datetime-local" label="Início · Brasília" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.currentTarget.value })} /><TextInput type="datetime-local" label="Término · Brasília" required value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.currentTarget.value })} /></SimpleGrid>
      <MultiSelect label="Participantes" searchable required data={(options?.members || []).map((user) => ({ value: user.id, label: user.name || user.email }))} value={form.participantIds} onChange={(participantIds) => setForm({ ...form, participantIds })} />
      <TagsInput label="Convidados externos" description="Digite o e-mail e pressione Enter. Convites são enviados pelo Google Agenda do organizador." placeholder="nome@empresa.com" value={form.externalEmails} onChange={(externalEmails) => setForm({ ...form, externalEmails })} splitChars={[",", ";", " "]} maxTags={100} />
      <Checkbox label="Gerar link do Google Meet automaticamente" checked={form.generateMeet} onChange={(event) => setForm({ ...form, generateMeet: event.currentTarget.checked })} disabled={editing && Boolean(meeting?.meetLink)} />
      {(form.generateMeet || form.externalEmails.length > 0) && !options?.googleConnected && <Alert color="orange">Conecte a agenda Google do organizador em Minha agenda para gerar o Meet e enviar convites externos. A reunião pode ser salva no Hub enquanto isso.</Alert>}
      <TextInput label="Local ou link da chamada" value={form.location} maxLength={1000} onChange={(event) => setForm({ ...form, location: event.currentTarget.value })} />
      <Textarea label="Pauta" value={form.agenda} autosize minRows={3} maxLength={20000} onChange={(event) => setForm({ ...form, agenda: event.currentTarget.value })} /><Textarea label="Ata / notas gerais" value={form.notes} autosize minRows={3} maxLength={30000} onChange={(event) => setForm({ ...form, notes: event.currentTarget.value })} />
      {editing && meeting && <Select label="Situação" allowDeselect={false} data={Object.entries(meetingStatus).map(([value, label]) => ({ value, label }))} value={form.status} onChange={(status) => setForm({ ...form, status: status || "SCHEDULED" })} />}
      <Button loading={busy} onClick={() => void run(async () => { const result = await meetingRequest<{ meeting: { id: string } }>(editing && meeting ? `/api/meetings?id=${meeting.id}` : "/api/meetings", jsonRequest(editing ? "PATCH" : "POST", { ...form, startsAt: inputToIso(form.startsAt), endsAt: inputToIso(form.endsAt), ...(editing && meeting ? { revision: meeting.revision } : {}) })); setModal(false); await openMeeting(result.meeting.id); await loadList(); notifications.show({ color: "green", message: "Reunião salva. Convites e agendas estão na fila de atualização." }); })}>Salvar reunião e atualizar agendas</Button>
    </Stack></Modal>
    <Modal opened={actionModal} onClose={() => !busy && setActionModal(false)} title={editingAction ? "Editar entrega" : "Nova entrega"}><Stack>
      <TextInput label="O que será entregue?" required value={task.title} maxLength={300} onChange={(event) => setTask({ ...task, title: event.currentTarget.value })} /><Textarea label="Critério de conclusão / detalhes" value={task.description} maxLength={5000} onChange={(event) => setTask({ ...task, description: event.currentTarget.value })} />
      <Select label="Responsável" required searchable data={(meeting?.participants || []).filter((item) => canManage || item.userId === options?.userId).map(({ user }) => ({ value: user.id, label: user.name || user.email }))} value={task.responsibleId} onChange={(responsibleId) => setTask({ ...task, responsibleId: responsibleId || "" })} /><TextInput type="datetime-local" label="Prazo · Brasília" required value={task.dueAt} onChange={(event) => setTask({ ...task, dueAt: event.currentTarget.value })} />
      <Button loading={busy} disabled={!task.title.trim() || !task.responsibleId || !task.dueAt} onClick={() => meeting && void run(async () => { await meetingRequest("/api/meetings/actions", jsonRequest(editingAction ? "PATCH" : "POST", { ...task, dueAt: inputToIso(task.dueAt), meetingId: meeting.id, ...(editingAction ? { id: editingAction.id, revision: editingAction.revision } : {}) })); setActionModal(false); await openMeeting(meeting.id); await loadList(); })}>Salvar entrega na agenda</Button>
    </Stack></Modal>
  </div>;
}
