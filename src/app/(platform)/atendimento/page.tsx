"use client";
import { useUsageClient } from "@/modules/usage/client-context";
import { EmailAnalyticsPanel } from "@/modules/atendimento/components/email-analytics-panel";

import {
  ActionIcon,
  Menu,
  Tooltip,
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
  IconTrash,
  IconChevronDown,
  IconBuilding,
  IconRefresh,
  IconDotsVertical,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconChartBar,
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
  ["GENERAL", "Caixa de entrada", "general", IconInbox],
  ["UNASSIGNED", "Não atribuídos", "unassigned", IconUsers],
  ["WAITING", "Aguardando", "waiting", IconClock],
  ["RESOLVED", "Concluídos", "resolved", IconCircleCheck],
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
  const [clientSearch,setClientSearch]=useState("");
  const [sidebarHidden,setSidebarHidden]=useState(false);
  const [clientsExpanded,setClientsExpanded]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Any | null>(null);
  useUsageClient(selected?.client?.id);
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
  }, [view, search, clientId, page]);

  async function archiveMailbox(action: "archive" | "restore" | "delete") {
    setArchiveAction(null);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/atendimento/archive", { method: action === "delete" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation: deleteConfirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao atualizar a caixa.");
      detailSequence.current++;setSelected(null); setSelectedId(null);
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
    setSelected(null);setNote("");
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
    const sequence=detailSequence.current;
    const targetId=selectedId;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/atendimento/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao atualizar chamado.");

      if(sequence===detailSequence.current)setSelected(body.ticket);
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

  const visibleClients=useMemo(()=>{
    const fold=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
    const needle=fold(clientSearch.trim());
    return (bootstrap?.clients||[]).filter((client:Any)=>!needle||fold(client.name).includes(needle));
  },[bootstrap,clientSearch]);
  const closeReading=()=>{detailSequence.current++;setSelected(null);setSelectedId(null);setNote("");};
  const chooseFolder=(value:string)=>{invalidateList();setView(value);setPage(1);closeReading();};
  const chooseClient=(value:string|null)=>{invalidateList();setClientId(value);setPage(1);closeReading();};
  const canEditSelected=Boolean(bootstrap?.permission?.canEdit&&(bootstrap?.currentUser?.canManage||selected?.assignedTo?.id===bootstrap?.currentUser?.id));
  const folderLabel=views.find(row=>row[0]===view)?.[1]||"Caixa de entrada";
  const selectedClientName=clientId==="UNIDENTIFIED"?"Cliente não identificado":bootstrap?.clients?.find((client:Any)=>client.id===clientId)?.name;
  async function refreshMailbox(){if(refreshing)return;setRefreshing(true);setError("");try{const r=await fetch("/api/atendimento/gmail/sync",{method:"POST"});const b=await r.json();if(!r.ok)throw new Error(b.error||"Não foi possível atualizar o Gmail.");await loadTickets();}catch(e){setError(e instanceof Error?e.message:"Não foi possível atualizar os e-mails.");}finally{setRefreshing(false);}}
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
      <header className={styles.mailHeader}>
        <Group gap="sm" wrap="nowrap"><ThemeIcon size={36} radius="md" variant="light"><IconMail size={22}/></ThemeIcon><Title order={2} className={styles.mailTitle}>E-mails</Title></Group>
        <TextInput className={styles.mailSearch} aria-label="Pesquisar e-mails" placeholder="Pesquisar assunto, remetente ou cliente" leftSection={<IconSearch size={18}/>} value={search} onChange={event=>{invalidateList();setSearch(event.currentTarget.value);setPage(1);}} maxLength={200}/>
        <Group gap={5} wrap="nowrap">
          {bootstrap.currentUser?.canManage&&<Tooltip label={analyticsOpen?"Voltar à caixa":"Análise de e-mails"}><ActionIcon variant={analyticsOpen?"light":"subtle"} size="lg" aria-label="Análise de e-mails" onClick={()=>setAnalyticsOpen(value=>!value)}><IconChartBar size={21}/></ActionIcon></Tooltip>}
          <Menu position="bottom-end" width={255} shadow="md"><Menu.Target><ActionIcon size="lg" variant="subtle" aria-label="Opções dos e-mails"><IconDotsVertical size={21}/></ActionIcon></Menu.Target><Menu.Dropdown>
            <Menu.Item onClick={()=>setConnectionOpen(true)}>Conexão Gmail</Menu.Item>
            {bootstrap.permission?.canManage&&<><Menu.Divider/><Menu.Item disabled={saving} onClick={()=>setArchiveAction(view==="ARCHIVED"?"restore":"archive")}>{view==="ARCHIVED"?"Restaurar arquivados":"Arquivar caixa atual"}</Menu.Item>{view==="ARCHIVED"&&<Menu.Item color="red" onClick={()=>{setDeleteConfirmation("");setArchiveAction("delete");}}>Excluir todos os arquivados</Menu.Item>}</>}
            {bootstrap.permission?.canCreate&&bootstrap.currentUser?.canManage&&<><Menu.Divider/><Menu.Item onClick={()=>setNewOpen(true)}>Simular e-mail para teste</Menu.Item></>}
          </Menu.Dropdown></Menu>
        </Group>
      </header>
      {error&&<Alert color="red" withCloseButton onClose={()=>setError("")}>{error}</Alert>}
      <Modal opened={connectionOpen} onClose={()=>setConnectionOpen(false)} title="Conexão Gmail" size="lg"><GmailConnectionCard/></Modal>
      {analyticsOpen&&bootstrap.currentUser?.canManage?<div className={styles.analyticsWorkspace}><EmailAnalyticsPanel clients={clientOptions}/></div>:<>
      <div className={styles.mailToolbar}>
        <Group gap={5} wrap="nowrap"><Tooltip label={sidebarHidden?"Mostrar pastas e clientes":"Recolher pastas e clientes"}><ActionIcon aria-label={sidebarHidden?"Mostrar pastas e clientes":"Recolher pastas e clientes"} variant="subtle" onClick={()=>setSidebarHidden(v=>!v)}>{sidebarHidden?<IconLayoutSidebarLeftExpand size={19}/>:<IconLayoutSidebarLeftCollapse size={19}/>}</ActionIcon></Tooltip><Button variant="subtle" size="compact-sm" loading={refreshing} leftSection={<IconRefresh size={16}/>} onClick={()=>void refreshMailbox()}>Atualizar</Button></Group>
        <Group gap={5} wrap="nowrap"><Button size="compact-sm" variant="subtle" color="teal" leftSection={<IconCircleCheck size={16}/>} disabled={!selected||!canEditSelected||saving||selected.status==="RESOLVED"} onClick={()=>void updateTicket("status",{status:"RESOLVED"})}>Concluir</Button><Button size="compact-sm" variant="subtle" color="gray" leftSection={<IconTrash size={16}/>} disabled={!selected||!canEditSelected||saving||selected.status==="SPAM"} onClick={()=>void updateTicket("status",{status:"SPAM"})}>Spam</Button></Group>
      </div>
      <div className={`${styles.outlookLayout} ${sidebarHidden?styles.sidebarHidden:""} ${selectedId?styles.hasSelection:""}`}>
        {!sidebarHidden&&<aside className={styles.mailFolders} aria-label="Pastas e clientes">
          <Text className={styles.folderHeading}>Pastas</Text>
          <div className={styles.folderList}>{views.filter(([value])=>value!=="UNASSIGNED"||bootstrap.currentUser?.canManage).map(([value,label,stat,Icon])=><button type="button" key={value} className={`${styles.folderButton} ${view===value?styles.folderActive:""}`} aria-pressed={view===value} onClick={()=>chooseFolder(value)}><Icon size={17}/><span>{label}</span><span className={styles.folderCount}>{stats[stat]??0}</span></button>)}</div>
          <button type="button" className={styles.clientSectionTitle} aria-expanded={clientsExpanded} onClick={()=>setClientsExpanded(v=>!v)}><IconChevronDown size={15} style={{transform:clientsExpanded?undefined:"rotate(-90deg)"}}/><span>Clientes</span><Text size="xs" c="dimmed">{bootstrap.clients?.length||0}</Text></button>
          {clientsExpanded&&<div className={styles.clientNavigation}><TextInput aria-label="Buscar cliente na caixa de e-mails" placeholder="Buscar cliente" leftSection={<IconSearch size={14}/>} size="xs" value={clientSearch} onChange={e=>setClientSearch(e.currentTarget.value)} maxLength={150}/><ScrollArea className={styles.clientScroll} type="auto" scrollbarSize={6}><button type="button" className={`${styles.clientButton} ${!clientId?styles.clientActive:""}`} aria-pressed={!clientId} onClick={()=>chooseClient(null)}><IconBuilding size={15}/><span>Todos os clientes</span></button><button type="button" className={`${styles.clientButton} ${clientId==="UNIDENTIFIED"?styles.clientActive:""}`} aria-pressed={clientId==="UNIDENTIFIED"} onClick={()=>chooseClient("UNIDENTIFIED")}><IconUsers size={15}/><span>Não identificado</span><small>{clientCounts.UNIDENTIFIED||0}</small></button>{visibleClients.map((client:Any)=><button type="button" key={client.id} title={client.name} aria-pressed={clientId===client.id} className={`${styles.clientButton} ${clientId===client.id?styles.clientActive:""}`} onClick={()=>chooseClient(client.id)}><IconBuilding size={15}/><span>{client.name}</span><small>{clientCounts[client.id]||0}</small></button>)}{!visibleClients.length&&<Text size="xs" c="dimmed" p="sm">Nenhum cliente encontrado.</Text>}</ScrollArea></div>}
        </aside>}
        <section className={styles.mailList} aria-label="Lista de e-mails">
          <div className={styles.mailListHeading}><div><Text fw={750} size="sm">{folderLabel}</Text><Text size="xs" c="dimmed" lineClamp={2} title={selectedClientName}>{selectedClientName||"Todos os clientes"}</Text></div><Badge variant="light" size="sm">{total}</Badge></div>
          <ScrollArea className={styles.mailListScroll} type="auto" scrollbarSize={6}>{!tickets.length?<Stack align="center" gap="xs" py={65} px="md"><IconInbox size={34} stroke={1.2}/><Text fw={650} size="sm">Nenhum e-mail encontrado</Text><Text size="xs" c="dimmed" ta="center">{search.trim()?"Tente outro assunto ou remetente.":"Nenhum e-mail nesta pasta para o cliente selecionado."}</Text></Stack>:tickets.map(ticket=><button type="button" key={ticket.id} aria-pressed={selectedId===ticket.id} className={`${styles.mailRow} ${selectedId===ticket.id?styles.mailRowSelected:""}`} onClick={()=>void openTicket(ticket.id)}><div className={styles.mailRowTop}><span className={styles.sender}>{ticket.senderName||ticket.senderEmail}</span><time>{formatDate(ticket.lastMessageAt)}</time></div><Text className={styles.mailRowSubject} size="sm" fw={650} lineClamp={1}>{ticket.subject}</Text><Text size="xs" c="dimmed" lineClamp={1}>{ticket.snippet||ticket.senderEmail}</Text><div className={styles.mailRowBottom}><Text size="xs" c="blue" lineClamp={1}>{ticket.client?.name||"Cliente não identificado"}</Text><span className={styles.statusDot} data-status={ticket.status} title={statusLabels[ticket.status]||ticket.status} aria-label={statusLabels[ticket.status]||ticket.status}/></div></button>)}</ScrollArea>
          {total>100&&<Group justify="center" className={styles.mailPagination}><Pagination total={Math.ceil(total/100)} value={page} onChange={setPage} size="xs" siblings={0}/></Group>}
        </section>
        <div className={styles.readingPane}>
          {selectedId?<EmailTicketDrawer key={selectedId} inline opened loading={detailLoading} ticket={selected} bootstrap={bootstrap} saving={saving} note={note} setNote={setNote} updateTicket={updateTicket} memberOptions={memberOptions} clientOptions={clientOptions} onClose={closeReading}/>:<Stack className={styles.readingEmpty} align="center" justify="center" gap="sm"><div className={styles.envelopeIllustration}><IconMail size={52} stroke={1.1}/></div><Text size="lg" fw={650}>Selecione um e-mail para ler</Text><Text size="sm" c="dimmed" ta="center" maw={330}>Escolha uma mensagem na lista para ver a conversa e responder.</Text></Stack>}
        </div>
      </div></>}

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
