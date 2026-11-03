"use client";
import { EmailAnalyticsPanel } from "@/modules/atendimento/components/email-analytics-panel";

import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Pagination,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconClock,
  IconInbox,
  IconMail,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { GmailConnectionCard } from "@/modules/atendimento/components/gmail-connection-card";
import { EmailTicketDrawer } from "@/modules/atendimento/components/email-ticket-drawer";
import styles from "./atendimento.module.css";

type Any = Record<string, any>;

const views = [
  ["GENERAL", "Caixa Geral", "general", IconInbox],
  ["MINE", "Minha Caixa", "mine", IconUser],
  ["UNASSIGNED", "Não atribuídos", "unassigned", IconUsers],
  ["WAITING", "Aguardando", "waiting", IconClock],
  ["RESOLVED", "Resolvidos", "resolved", IconCircleCheck],
  ["SPAM", "Spam", "spam", IconTrash],
  ["ARCHIVED", "Arquivados", "archived", IconInbox],
] as const;

const statusLabels: Any = {
  NEW: "Novo",
  IN_PROGRESS: "Em atendimento",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_INTERNAL: "Aguardando interno",
  RESOLVED: "Resolvido",
  SPAM: "Spam",
};

const statusColors: Any = {
  NEW: "blue",
  IN_PROGRESS: "cyan",
  WAITING_CUSTOMER: "yellow",
  WAITING_INTERNAL: "orange",
  RESOLVED: "green",
  SPAM: "gray",
};

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default function AtendimentoPage() {
  const [bootstrap, setBootstrap] = useState<Any | null>(null);
  const [tickets, setTickets] = useState<Any[]>([]);
  const [stats, setStats] = useState<Any>({});
  const [view, setView] = useState("GENERAL");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientCounts, setClientCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [analyticsOpen, setAnalyticsOpen] = useState(false), [connectionOpen, setConnectionOpen] = useState(false);
  const listSequence = useRef(0);
  const invalidateList = useCallback(()=>{listSequence.current++;},[]);
  const detailSequence = useRef(0);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiveAction, setArchiveAction] = useState<"archive" | "restore" | "delete" | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [note, setNote] = useState("");

  const [form, setForm] = useState({
    subject: "",
    senderName: "",
    senderEmail: "",
    recipientEmail: "",
    textBody: "",
    clientId: "",
    assignedToId: "",
    priority: "MEDIUM",
  });


  const loadBootstrap = useCallback(async () => {
    const response = await fetch("/api/atendimento/bootstrap", {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Erro ao carregar Central.");
    setBootstrap(body);
  }, []);

  const loadTickets = useCallback(async () => {
    const request = ++listSequence.current;
    const query = new URLSearchParams({ view, page: String(page) });
    if(clientId) query.set("clientId", clientId);
    if (search.trim()) query.set("search", search.trim());
    if (selectedMemberId) query.set("assignedToId", selectedMemberId);

    const response = await fetch(
      `/api/atendimento?${query.toString()}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Erro ao carregar chamados.");
    if(request !== listSequence.current) return;
    setTotal(body.total || 0); setClientCounts(body.clientCounts || {});
    const lastPage = Math.max(1, Math.ceil((body.total || 0) / 100)); if(page > lastPage) setPage(lastPage);
    setTickets(body.tickets || []);
    setStats(body.stats || {});
  }, [view, search, selectedMemberId, clientId, page]);

  async function archiveMailbox(action: "archive" | "restore" | "delete") {
    setArchiveAction(null);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/atendimento/archive", { method: action === "delete" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation: deleteConfirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao atualizar a caixa.");
      setSelected(null); setSelectedId(null);
      setDeleteConfirmation("");
      await loadTickets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar a caixa."); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    let active = true;
    const initial = setTimeout(()=>{void loadBootstrap().catch(cause => {if(active) setError(cause instanceof Error ? cause.message : "Erro ao carregar Central.");}).finally(()=>{if(active)setLoading(false);});},0);
    return ()=>{active=false;clearTimeout(initial);};
  },[loadBootstrap]);
  useEffect(()=>{const timer=setTimeout(()=>{void loadTickets().catch(cause=>setError(cause instanceof Error?cause.message:"Erro ao carregar chamados."));},200);return()=>{clearTimeout(timer);invalidateList();};},[loadTickets,invalidateList]);
  const listLoader = useRef(loadTickets);
  useEffect(()=>{listLoader.current=loadTickets;},[loadTickets]);
  useEffect(()=>{let busy=false;const refresh=async()=>{if(busy||document.visibilityState!=="visible")return;busy=true;try{await fetch("/api/atendimento/gmail/sync",{method:"POST"});await listLoader.current();}catch{}finally{busy=false;}};const timer=window.setInterval(()=>void refresh(),60000);document.addEventListener("visibilitychange",refresh);return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};},[]);

  const openTicket = useCallback(async (id: string) => {
    const request = ++detailSequence.current;
    setSelectedId(id);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/atendimento/${id}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao abrir chamado.");
      if(request !== detailSequence.current) return;
      setSelected(body.ticket);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível abrir o chamado.",
      );
    } finally {
      if(request === detailSequence.current) setDetailLoading(false);
    }
  }, []);

  async function updateTicket(action: string, payload: Any = {}) {
    if (!selectedId) return false;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/atendimento/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao atualizar chamado.");

      setSelected(body.ticket);
      await loadTickets();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível atualizar.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createTestTicket() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/atendimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao criar chamado.");

      setNewOpen(false);
      setForm({
        subject: "",
        senderName: "",
        senderEmail: "",
        recipientEmail: "",
        textBody: "",
        clientId: "",
        assignedToId: "",
        priority: "MEDIUM",
      });
      await loadTickets();
      await openTicket(body.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao criar chamado.");
    } finally {
      setSaving(false);
    }
  }

  const memberOptions = useMemo(
    () =>
      (bootstrap?.members || []).map((member: Any) => ({
        value: member.id,
        label: member.name || member.email,
      })),
    [bootstrap],
  );

  const clientOptions = useMemo(
    () =>
      (bootstrap?.clients || []).map((client: Any) => ({
        value: client.id,
        label: client.name,
      })),
    [bootstrap],
  );

  const selectedTeamMember = useMemo(
    () =>
      (bootstrap?.members || []).find(
        (member: Any) => member.id === selectedMemberId,
      ) || null,
    [bootstrap, selectedMemberId],
  );

  const filterClients = useMemo(() => {
    const owner = view === "MINE" ? bootstrap?.currentUser?.id : selectedMemberId || (!bootstrap?.currentUser?.canManage && view !== "GENERAL" ? bootstrap?.currentUser?.id : null);
    return (bootstrap?.clients || []).filter((client: Any) => !owner || [client.operationLeaderId,client.generalResponsibleId,client.payableResponsibleId,client.receivableResponsibleId].includes(owner) || clientCounts[client.id] > 0).map((client:Any)=>({value:client.id,label:client.name + " (" + (clientCounts[client.id] || 0) + ")"}));
  },[bootstrap,view,selectedMemberId,clientCounts]);

  if (loading) {
    return (
      <Group justify="center" py={80}>
        <Loader />
      </Group>
    );
  }

  if (!bootstrap) {
    return <Alert color="red">{error || "Central indisponível."}</Alert>;
  }


  return (
    <Stack gap="sm" className={styles.page}>
      <Modal opened={archiveAction !== null} onClose={() => setArchiveAction(null)} title={archiveAction === "delete" ? "Excluir todos os arquivados" : archiveAction === "restore" ? "Restaurar arquivados" : "Limpar caixa de e-mails"}>
        <Stack>
          <Text size="sm">{archiveAction === "delete" ? `Excluir definitivamente os ${stats.archived ?? 0} atendimentos arquivados, incluindo mensagens, anexos e histórico no Fortuno Hub. Esta ação não pode ser desfeita. Os originais no Gmail não serão alterados.` : archiveAction === "restore" ? "Os atendimentos arquivados voltarão às caixas originais." : "Os atendimentos atuais serão movidos para Arquivados e poderão ser restaurados. Os e-mails originais no Gmail não serão alterados."}</Text>
          {archiveAction === "delete" && <TextInput label="Digite EXCLUIR ARQUIVADOS para confirmar" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.currentTarget.value)} />}
          <Group justify="flex-end"><Button variant="default" onClick={() => setArchiveAction(null)}>Cancelar</Button><Button color={archiveAction === "delete" ? "red" : undefined} disabled={archiveAction === "delete" && deleteConfirmation !== "EXCLUIR ARQUIVADOS"} onClick={() => archiveAction && void archiveMailbox(archiveAction)}>{archiveAction === "delete" ? "Excluir definitivamente" : archiveAction === "restore" ? "Restaurar atendimentos" : "Arquivar atendimentos"}</Button></Group>
        </Stack>
      </Modal>
      <Group
        justify="space-between"
        align="flex-start"
        className={styles.pageHeader}
      >
        <Stack gap={3}>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>
            Fortuno Hub
          </Text>
          <Title order={2} className={styles.pageTitle}>
            Central de e-mails
          </Title>
        </Stack>

        <Group className={styles.headerActions}>
          <Button variant="subtle" onClick={()=>setConnectionOpen(value=>!value)}>Conexão Gmail</Button>
          {bootstrap.permission?.canManage && view === "ARCHIVED" && <Button color="red" variant="light" loading={saving} onClick={() => { setDeleteConfirmation(""); setArchiveAction("delete"); }}>Excluir todos os arquivados</Button>}
          {bootstrap.permission?.canManage && <Button variant="default" loading={saving} onClick={() => setArchiveAction(view === "ARCHIVED" ? "restore" : "archive")}>{view === "ARCHIVED" ? "Restaurar arquivados" : "Limpar caixa"}</Button>}
          <Badge size="lg" variant="light" leftSection={<IconSparkles size={13} />}>
            Atendimento por e-mail
          </Badge>

          {bootstrap.permission?.canCreate && bootstrap.currentUser?.canManage && (
            <Button
              leftSection={<IconMail size={17} />}
              onClick={() => setNewOpen(true)}
            >
              Simular e-mail
            </Button>
          )}
        </Group>
      </Group>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <Group gap="xs"><Button variant={!analyticsOpen?"light":"subtle"} onClick={()=>setAnalyticsOpen(false)}>Caixa de e-mails</Button>{bootstrap.currentUser?.canManage && <Button variant={analyticsOpen?"light":"subtle"} onClick={()=>setAnalyticsOpen(true)}>Análise e gestão</Button>}</Group>
      {connectionOpen && <div className={styles.gmailCard}><GmailConnectionCard /></div>}

      {analyticsOpen && bootstrap.currentUser?.canManage ? <EmailAnalyticsPanel clients={clientOptions} members={memberOptions}/> : <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <Stack gap={6}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase" px={8} py={6}>
              Caixas
            </Text>

            {views.filter(([value])=>value!=="UNASSIGNED" || bootstrap.currentUser?.canManage).map(([value, label, stat, Icon]) => (
              <Button
                key={value}
                className={styles.viewButton}
                variant={view === value ? "light" : "subtle"}
                color={value === "SPAM" ? "gray" : "blue"}
                justify="space-between"
                fullWidth
                leftSection={<Icon size={16} />}
                rightSection={
                  <Badge size="sm" variant={view === value ? "filled" : "light"}>
                    {stats[stat] ?? 0}
                  </Badge>
                }
                 onClick={() => {
                   setView(value);
                   if(value === "GENERAL" || value === "UNASSIGNED") setSelectedMemberId(null);
                   else if(value === "MINE") setSelectedMemberId(bootstrap.currentUser.id);
                   setClientId(null); setPage(1);
                   setSelected(null);
                   setSelectedId(null);
                }}
              >
                {label}
              </Button>
             ))}

             {bootstrap.currentUser?.canManage && (
               <>
                 <Text
                   size="xs"
                   fw={800}
                   c="dimmed"
                   tt="uppercase"
                   px={8}
                   pt="md"
                   pb={6}
                   className={styles.teamTitle}
                 >
                   Equipe
                 </Text>
                 <ScrollArea.Autosize mah={280} type="auto">
                   <Stack gap={4}>
                     {(bootstrap.members || []).map((member: Any) => (
                       <Button
                         key={member.id}
                         className={`${styles.viewButton} ${styles.teamButton}`}
                         variant={selectedMemberId === member.id ? "light" : "subtle"}
                         justify="space-between"
                         fullWidth
                         leftSection={<IconUser size={15} />}
                         rightSection={
                           <Badge
                             size="sm"
                             variant={selectedMemberId === member.id ? "filled" : "light"}
                           >
                             {stats.byMember?.[member.id] ?? 0}
                           </Badge>
                         }
                         title={member.name || member.email}
                         onClick={() => {
                           setView("TEAM"); setClientId(null); setPage(1);
                           setSelectedMemberId(member.id);
                           setSelected(null);
                           setSelectedId(null);
                         }}
                       >
                         {member.name || member.email}
                       </Button>
                     ))}
                   </Stack>
                 </ScrollArea.Autosize>
               </>
             )}
           </Stack>
        </aside>

        <section className={styles.list}>
          <div className={styles.searchBar}>
            <Group gap="sm" wrap="wrap">
              {selectedTeamMember && (
                <Badge size="lg" variant="light" className={styles.memberFilterBadge}>
                  {selectedTeamMember.name || selectedTeamMember.email}
                </Badge>
              )}
              <Select aria-label="Filtrar e-mails por cliente" placeholder="Todos os clientes" searchable clearable value={clientId} data={[{value:"UNIDENTIFIED",label:"Cliente não identificado (" + (clientCounts.UNIDENTIFIED || 0) + ")"},...filterClients]} onChange={value=>{setClientId(value);setPage(1);}} style={{minWidth:280,flex:1}}/>
              <TextInput
                placeholder={
                  selectedTeamMember
                    ? `Buscar nos e-mails de ${selectedTeamMember.name || selectedTeamMember.email}...`
                    : "Buscar cliente, assunto ou remetente..."
                }
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(event) => {setSearch(event.currentTarget.value);setPage(1);}}
                style={{ flex: 1 }}
              />
            </Group>
          </div>

          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
            {!tickets.length ? (
              <Stack align="center" gap="xs" py={80} px="md">
                <ThemeIcon size={50} radius="xl" variant="light">
                  <IconInbox size={24} />
                </ThemeIcon>
                <Text fw={700}>Caixa vazia</Text>
                <Text size="sm" c="dimmed" ta="center">
                  Nenhum chamado encontrado nesta visão.
                </Text>
              </Stack>
            ) : (
              tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`${styles.ticketRow} ${
                    selectedId === ticket.id ? styles.ticketRowActive : ""
                  }`}
                  onClick={() => void openTicket(ticket.id)}
                >
                  <div className={styles.ticketMain}>
                    <Group gap={8} wrap="nowrap">
                      <Text size="sm" fw={800} lineClamp={1}>
                        {ticket.client?.name ||
                          ticket.senderName ||
                          ticket.senderEmail}
                      </Text>

                      <Badge
                        size="xs"
                        color={statusColors[ticket.status] || "gray"}
                        variant="light"
                        className={styles.rowStatus}
                      >
                        {statusLabels[ticket.status] || ticket.status}
                      </Badge>

                      {!ticket.assignedTo ? (
                        <Badge
                          size="xs"
                          color="orange"
                          variant="light"
                          className={styles.rowAssignee}
                        >
                          Sem responsável
                        </Badge>
                      ) : (
                        <Badge
                          size="xs"
                          variant="outline"
                          className={styles.rowAssignee}
                        >
                          {ticket.assignedTo.name || ticket.assignedTo.email}
                        </Badge>
                      )}
                    </Group>

                    <Group gap={7} wrap="nowrap" mt={2}>
                      <Text
                        size="sm"
                        fw={600}
                        lineClamp={1}
                        className={styles.ticketSubject}
                      >
                        {ticket.subject}
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        lineClamp={1}
                        className={styles.ticketSnippet}
                      >
                        — {ticket.snippet || ticket.senderEmail}
                      </Text>
                    </Group>
                  </div>

                  <Text
                    size="xs"
                    c="dimmed"
                    className={styles.ticketDate}
                  >
                    {formatDate(ticket.lastMessageAt)}
                  </Text>
                </div>
              ))
            )}
          </ScrollArea>
          {total > 100 && <Group justify="center" py="xs"><Pagination total={Math.ceil(total/100)} value={page} onChange={setPage}/><Text size="xs" c="dimmed">{total} e-mails</Text></Group>}
        </section>

      </div>}

      <EmailTicketDrawer
        key={selectedId || "closed"}
        opened={Boolean(selectedId)}
        loading={detailLoading}
        ticket={selected}
        bootstrap={bootstrap}
        saving={saving}
        note={note}
        setNote={setNote}
        updateTicket={updateTicket}
        memberOptions={memberOptions}
        clientOptions={clientOptions}
        onClose={() => {
          detailSequence.current++;
          setSelected(null);
          setSelectedId(null);
        }}
      />

      <Modal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        title="Simular novo e-mail"
        size="lg"
      >
        <Stack>
          <Alert color="blue">
            Serve apenas para testar a Central antes da conexão real com o Gmail.
          </Alert>

          <Group grow align="flex-start">
            <TextInput
              label="Nome do remetente"
              value={form.senderName}
              onChange={(event) =>
                setForm({ ...form, senderName: event.currentTarget.value })
              }
            />
            <TextInput
              label="E-mail do remetente"
              required
              value={form.senderEmail}
              onChange={(event) =>
                setForm({ ...form, senderEmail: event.currentTarget.value })
              }
            />
          </Group>

          <TextInput
            label="Assunto"
            required
            value={form.subject}
            onChange={(event) =>
              setForm({ ...form, subject: event.currentTarget.value })
            }
          />

          <Textarea
            label="Mensagem"
            required
            minRows={5}
            value={form.textBody}
            onChange={(event) =>
              setForm({ ...form, textBody: event.currentTarget.value })
            }
          />

          <Group grow align="flex-start">
            <Select
              label="Cliente opcional"
              searchable
              clearable
              data={clientOptions}
              value={form.clientId || null}
              onChange={(value) =>
                setForm({ ...form, clientId: value || "" })
              }
            />
            <Select
              label="Responsável opcional"
              searchable
              clearable
              data={memberOptions}
              value={form.assignedToId || null}
              onChange={(value) =>
                setForm({ ...form, assignedToId: value || "" })
              }
            />
          </Group>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={() => void createTestTicket()}>
              Criar chamado
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
