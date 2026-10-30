"use client";

import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBrandWhatsapp,
  IconArrowRight,
  IconRefresh,
  IconChartBar,
  IconCheck,
  IconInbox,
  IconMessageCircle,
  IconSearch,
  IconSend,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WhatsAppMonitoring } from "./monitoring";
import { UazapiConnection } from "@/modules/whatsapp/uazapi-connection";
import { mergeChatMessages } from "@/modules/whatsapp/message-pages";
import { ChatAvatar } from "@/modules/whatsapp/chat-avatar";
import { ChatMessages } from "@/modules/whatsapp/chat-messages";
import { WhatsAppTransferDialog } from "@/modules/whatsapp/transfer-dialog";
import { inboxFacets, matchesInboxFilters, type InboxKind, type InboxStatus, type InboxView } from "@/modules/whatsapp/inbox-filters";
import styles from "./whatsapp.module.css";

type View = InboxView;
type Section = "INBOX" | "MONITORING";

type Bootstrap = {
  mode: string;
  currentUser: { id: string; name: string | null; email: string };
  canManage: boolean;
  canEdit: boolean;
  canConfigureConnection: boolean;
  clients: Array<{
    id: string;
    name: string;
    document: string | null;
    operationLeaderId: string | null;
    payableResponsibleId: string | null;
    receivableResponsibleId: string | null;
    generalResponsibleId: string | null;
    contaAzulConnection: {
      status: string;
      active: boolean;
      externalTenantName: string | null;
    } | null;
  }>;
  members: Array<{ id: string; name: string | null; email: string; role: string; canAttend: boolean }>;
};

type Ticket = {
  unreadCount?: number;
  id: string;
  subject: string;
  senderName: string | null;
  senderEmail: string;
  snippet: string | null;
  status: string;
  routingArea: string;
  routingReason: string | null;
  assignedAt: string | null;
  receivedAt: string;
  resolvedAt: string | null;
  firstResponseAt: string | null;
  lastMessageAt: string;
  lastDirection: string | null;
  channel: { kind: "CONTACT" | "GROUP"; externalId: string };
  client: { id: string; name: string } | null;
  assignedTo: { id: string; name: string | null; email: string } | null;
  _count: { messages: number };
};

type TicketDetail = Omit<Ticket, "lastDirection" | "channel" | "_count"> & {
  source: string;
  client: {
    id: string;
    name: string;
    document: string | null;
    contaAzulConnection: {
      status: string;
      active: boolean;
      externalTenantName: string | null;
    } | null;
  } | null;
  hasOlderMessages?: boolean;
  updatedAt?: string;
  messages: Array<{
    id: string;
    direction: "INBOUND" | "OUTBOUND" | "INTERNAL";
    fromName: string | null;
    textBody: string | null;
    receivedAt: string;
    deliveryStatus: string | null;
    attachments: Array<{
      id: string;
      name: string;
      mimeType: string | null;
      size: number | null;
    }>;
  }>;
  history: Array<{
    id: string;
    type: string;
    message: string;
    metadata: unknown;
    createdAt: string;
  }>;
};

type Stats = {
  facets?: { view: Record<InboxView, number>; kind: Record<InboxKind, number>; status: Record<InboxStatus, number> };
  general: number;
  active: number;
  mine: number;
  queue: number;
  waitingResponse: number;
  averageQueueMinutes: number;
  averageFirstResponseMinutes: number;
  averageHandlingMinutes: number;
  satisfaction: number | null;
  satisfactionResponses: number;
};
type HistorySync = { status: string; queued: number; lastError: string | null; completedAt: string | null };

const areaOptions = [
  { value: "UNKNOWN", label: "Ainda não identificado" },
  { value: "ACCOUNTS_PAYABLE", label: "Contas a pagar" },
  { value: "ACCOUNTS_RECEIVABLE", label: "Contas a receber" },
  { value: "GENERAL", label: "Atendimento geral" },
];

const statusLabels: Record<string, string> = {
  NEW: "Na fila",
  IN_PROGRESS: "Em atendimento",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_INTERNAL: "Aguardando resposta",
  RESOLVED: "Finalizado",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function readResponse<T>(response: Response) {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
  return payload;
}

export default function WhatsAppPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [section, setSection] = useState<Section>("INBOX");
  const [view, setView] = useState<View>("GENERAL");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [chatKind, setChatKind] = useState<InboxKind>("ALL");
  const [chatStatus, setChatStatus] = useState<InboxStatus>("OPEN");
  const [transferOpened, setTransferOpened] = useState(false);
  const [inbox, setInbox] = useState<{ tickets: Ticket[]; complete: boolean; key: string }>({ tickets: [], complete: false, key: "" });
  const [baseStats, setStats] = useState<Stats | null>(null);
  const [preferredId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [connectionSettingsOpened, setConnectionSettingsOpened] = useState(false);
  const [reply, setReply] = useState("");
  const [historySync, setHistorySync] = useState<HistorySync | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const filterKey = JSON.stringify([view, chatKind, chatStatus, search.trim(), onlyUnread]);
  const currentUserId = bootstrap?.currentUser.id || "";
  const filters = useMemo(() => ({ view, kind: chatKind, status: chatStatus }), [view, chatKind, chatStatus]);
  const tickets = useMemo(() => {
    if (!inbox.complete) return inbox.key === filterKey ? inbox.tickets : [];
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return inbox.tickets.filter((ticket) => (!onlyUnread || Boolean(ticket.unreadCount)) && matchesInboxFilters({ ...ticket, assignedToId: ticket.assignedTo?.id || null }, filters, currentUserId) && (!needle || [ticket.subject, ticket.senderName, ticket.senderEmail, ticket.snippet, ticket.client?.name].some((value) => value?.toLocaleLowerCase("pt-BR").includes(needle))));
  }, [inbox, filterKey, filters, search, currentUserId, onlyUnread]);
  const stats = useMemo(() => baseStats && inbox.complete ? { ...baseStats, facets: inboxFacets(inbox.tickets.map((ticket) => ({ ...ticket, assignedToId: ticket.assignedTo?.id || null })), filters, currentUserId) } : baseStats, [baseStats, inbox, filters, currentUserId]);
  const selectedId = tickets.some((ticket) => ticket.id === preferredId) ? preferredId : onlyUnread ? null : tickets[0]?.id || null;
  const selectedRef = useRef<string | null>(null);
  const detailCache = useRef(new Map<string, TicketDetail>());
  const lastRevision = useRef("");
  const partialList = useRef(false);
  const ticketVersions = useRef(new Map<string,string>());
  const detailController = useRef<AbortController | null>(null);
  const listRequest = useRef(0), detailRequest = useRef(0);
  const [syncError, setSyncError] = useState(false);
  const connected = bootstrap?.mode === "CONNECTED";
  const onConnectionStatus = useCallback((status: string) => {
    setBootstrap((value) => value && value.mode !== status ? { ...value, mode: status } : value);
    if (status !== "CONNECTED") { setSection("INBOX"); setTransferOpened(false); setSimulatorOpen(false); setConnectionSettingsOpened(false); }
  }, []);
  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  const [simulation, setSimulation] = useState({
    kind: "CONTACT",
    displayName: "",
    identifier: "",
    message: "",
    routingArea: "UNKNOWN",
    clientId: "",
  });

  const readMarkers = useRef(new Map<string, string>());
  const markRead = useCallback(async (id: string, messageId: string) => {
    if (selectedRef.current !== id || document.visibilityState !== "visible" || readMarkers.current.get(id) === messageId) return;
    readMarkers.current.set(id, messageId);
    try {
      const response = await fetch('/api/whatsapp/' + encodeURIComponent(id) + '/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId }) });
      const body = await readResponse<{ unreadCount: number }>(response);
      listRequest.current++;
      lastRevision.current = "";
      setInbox(current => ({ ...current, tickets: current.tickets.map(ticket => ticket.id === id ? { ...ticket, unreadCount: body.unreadCount } : ticket) }));
    } catch { readMarkers.current.delete(id); }
  }, []);

  const loadList = useCallback(async () => {
    const request = ++listRequest.current;
    if (!partialList.current && !onlyUnread) {
    const snapshot = await readResponse<{ tickets: Ticket[]; stats: Stats; hasMore: boolean }>(await fetch("/api/whatsapp?view=GENERAL&kind=ALL&status=ALL&light=1", { cache: "no-store" }));
    if (request !== listRequest.current) return;
    for (const ticket of snapshot.tickets) ticketVersions.current.set(ticket.id, (ticket as Ticket & {updatedAt?:string}).updatedAt || "");
    if (!snapshot.hasMore) {
      setInbox({ tickets: snapshot.tickets, complete: true, key: "" }); setStats(snapshot.stats); return;
    }
    partialList.current = true;
    }
    const params = new URLSearchParams({ view, kind: chatKind, status: chatStatus, light: "1" });
    if (onlyUnread) params.set("unread", "1");
    if (search.trim()) params.set("search", search.trim());
    const payload = await readResponse<{ tickets: Ticket[]; stats: Stats }>(
      await fetch(`/api/whatsapp?${params}`, { cache: "no-store" }),
    );
    if (request !== listRequest.current) return;
    for (const ticket of payload.tickets) ticketVersions.current.set(ticket.id, (ticket as Ticket & {updatedAt?:string}).updatedAt || "");
    setInbox({ tickets: payload.tickets, complete: false, key: JSON.stringify([view, chatKind, chatStatus, search.trim(), onlyUnread]) });
    setStats(payload.stats);
  }, [search, view, chatKind, chatStatus, onlyUnread]);

  const loadDetail = useCallback(async (id: string, silent = false) => {
    const request = ++detailRequest.current;
    detailController.current?.abort();
    const controller = new AbortController(); detailController.current = controller;
    const cached = detailCache.current.get(id);
    if (cached && selectedRef.current === id) { setDetail(cached); setDetailLoading(false); }
    else if (!silent) setDetailLoading(true);
    try {
      const payload = await readResponse<{ ticket: TicketDetail }>(
        await fetch(`/api/whatsapp/${id}`, { cache: "no-store", signal: controller.signal }),
      );
      if (request === detailRequest.current && selectedRef.current === id) {
        const previous = detailCache.current.get(id);
        const messages = mergeChatMessages(previous?.messages || [], payload.ticket.messages);
        const next = {...payload.ticket, messages, hasOlderMessages: previous && previous.messages.length > payload.ticket.messages.length ? previous.hasOlderMessages : payload.ticket.hasOlderMessages};
        detailCache.current.set(id, next); setDetail(next);
        if (detailCache.current.size > 20) { const oldest = detailCache.current.keys().next().value; if (oldest && oldest !== id) detailCache.current.delete(oldest); }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!silent) notifications.show({
        color: "red",
        title: "Central WhatsApp",
        message: error instanceof Error ? error.message : "Não foi possível abrir a conversa.",
      });
      if (silent) throw error;
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/whatsapp/bootstrap", { cache: "no-store" })
      .then((response) => readResponse<Bootstrap>(response))
      .then(setBootstrap)
      .catch((error) =>
        notifications.show({
          color: "red",
          title: "Central WhatsApp",
          message: error instanceof Error ? error.message : "Não foi possível carregar o módulo.",
        }),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!connected || section !== "INBOX" || inbox.complete || !inbox.key) return;
    const timer = setTimeout(() => { void loadList().catch(() => setSyncError(true)); }, 0);
    return () => clearTimeout(timer);
  }, [connected, section, loadList, inbox.complete, inbox.key]);

  useEffect(() => {
    if (connected && section === "INBOX" && selectedId) {
      const timer = setTimeout(() => { void loadDetail(selectedId); }, 0);
      return () => clearTimeout(timer);
    }
  }, [connected, section, loadDetail, selectedId]);

  // Check a lightweight revision every two seconds; reload the inbox only when it changes.
  useEffect(() => {
    if (!connected || saving) return;
    let cancelled = false, busy = false;
    const controller = new AbortController();
    async function sync() {
      if (cancelled || busy || document.hidden) return;
      busy = true;
      try {
        const state = await readResponse<{ revision: string; mode: string; historySync: HistorySync | null }>(await fetch("/api/whatsapp/updates", { cache: "no-store", signal: controller.signal }));
        if (cancelled) return;
        onConnectionStatus(state.mode);
        setHistorySync(state.historySync || null);
        if (state.mode !== "CONNECTED") return;
        if (section === "INBOX" && lastRevision.current !== state.revision) {
          await loadList();
          const currentId = selectedRef.current;
          if (currentId && detailCache.current.get(currentId)?.updatedAt !== ticketVersions.current.get(currentId)) await loadDetail(currentId, true);
          if (!cancelled) lastRevision.current = state.revision;
        }
        if (!cancelled) setSyncError(false);
      } catch { if (!cancelled) setSyncError(true); }
      finally { busy = false; }
    }
    const start = setTimeout(() => { void sync(); }, 0);
    const timer = setInterval(() => { void sync(); }, 2000);
    const resume = () => { void sync(); };
    window.addEventListener("focus", resume); document.addEventListener("visibilitychange", resume);
    return () => { cancelled = true; controller.abort(); clearTimeout(start); clearInterval(timer); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [connected, section, saving, loadList, loadDetail, onConnectionStatus]);

  const clientOptions = useMemo(
    () =>
      (bootstrap?.clients || []).map((client) => ({
        value: client.id,
        label: client.document ? `${client.name} • ${client.document}` : client.name,
      })),
    [bootstrap],
  );
  const memberOptions = useMemo(
    () =>
      (bootstrap?.members || []).map((member) => ({
        value: member.id,
        label: member.name || member.email,
      })),
    [bootstrap],
  );

  const loadOlderMessages = useCallback(async () => {
    const id = selectedRef.current, previous = id ? detailCache.current.get(id) : null;
    if (!id || !previous?.messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const payload = await readResponse<{ticket:TicketDetail}>(await fetch(`/api/whatsapp/${id}?before=${encodeURIComponent(previous.messages[0].id)}`,{cache:"no-store"}));
      const current = detailCache.current.get(id) || previous;
      const next = {...current, messages:mergeChatMessages(current.messages,payload.ticket.messages),hasOlderMessages:payload.ticket.hasOlderMessages};
      detailCache.current.set(id,next);if(selectedRef.current===id)setDetail(next);
    }catch(error){notifications.show({color:"red",title:"Mensagens anteriores",message:error instanceof Error?error.message:"Não foi possível carregar o histórico."});}
    finally{setLoadingOlder(false);}
  }, [loadingOlder]);

  async function mutate(action: Record<string, unknown>, success: string) {
    if (!selectedId) return false;
    const id = selectedId;
    ++detailRequest.current;
    setSaving(true);
    try {
      const payload = await readResponse<{ ticket: TicketDetail }>(
        await fetch(`/api/whatsapp/${selectedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        }),
      );
      const previous = detailCache.current.get(id);
      const next = {...payload.ticket, messages:mergeChatMessages(previous?.messages || [],payload.ticket.messages),hasOlderMessages:previous && previous.messages.length > payload.ticket.messages.length ? previous.hasOlderMessages : payload.ticket.hasOlderMessages};
      detailCache.current.set(id, next);
      if (selectedRef.current === id) setDetail(next);
      await loadList();
      notifications.show({ color: "green", title: "Tudo certo", message: success });
      return true;
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Não foi possível concluir",
        message: error instanceof Error ? error.message : "Tente novamente.",
      });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendReply() {
    const content = reply.trim();
    if (!content) return;
    const sent = await mutate(
      { action: "reply", content },
      detail?.source === "WHATSAPP_API"
        ? "Resposta enviada pelo WhatsApp."
        : "Resposta registrada no teste.",
    );
    if (sent) setReply((current) => current.trim() === content ? "" : current);
  }

  async function syncHistory() {
    setHistoryBusy(true);
    try {
      const result = await readResponse<{ sync: HistorySync | null }>(await fetch("/api/whatsapp/history", { method: "POST" }));
      setHistorySync(result.sync);
    } catch (error) { notifications.show({ color: "red", title: "Histórico do WhatsApp", message: error instanceof Error ? error.message : "Não foi possível atualizar o histórico." }); }
    finally { setHistoryBusy(false); }
  }

  async function simulateMessage() {
    setSaving(true);
    try {
      const payload = await readResponse<{ ticket: { id: string } }>(
        await fetch("/api/whatsapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(simulation),
        }),
      );
      setSimulatorOpen(false);
      setSimulation({
        kind: "CONTACT",
        displayName: "",
        identifier: "",
        message: "",
        routingArea: "UNKNOWN",
        clientId: "",
      });
      await loadList();
      setSelectedId(payload.ticket.id);
      notifications.show({
        color: "green",
        title: "Mensagem recebida",
        message: "O fluxo de distribuição foi executado.",
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Simulação não concluída",
        message: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.loading}>
        <Loader size="sm" /> <Text>Preparando a Central WhatsApp...</Text>
      </div>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Group gap="sm" mb={7} align="center">
            <div className={styles.sectionTabs}>
              <button
                type="button"
                className={section === "INBOX" ? styles.sectionTabActive : ""}
                onClick={() => setSection("INBOX")}
              >
                <IconBrandWhatsapp size={18} /> Central WhatsApp
              </button>
              <button
                type="button"
                className={section === "MONITORING" ? styles.sectionTabActive : ""}
                disabled={!connected}
                onClick={() => setSection("MONITORING")}
              >
                <IconChartBar size={18} /> Central de monitoramento
              </button>
            </div>
            <Badge color={bootstrap?.mode === "CONNECTED" ? "green" : "yellow"} variant="light">
              {bootstrap?.mode === "CONNECTED" ? "Conectado" : "WhatsApp desconectado"}
            </Badge>
            {section === "INBOX" && syncError && <Text size="xs" c="orange">Reconectando atualização automática…</Text>}
            {connected && historySync && ["PENDING", "RUNNING", "IMPORTING"].includes(historySync.status) && <Badge color="teal" variant="light">Sincronizando histórico…</Badge>}
            {connected && historySync?.status === "FAILED" && <Text size="xs" c="orange">Histórico pendente de atualização</Text>}
          </Group>
        </div>
        {connected && <Group gap="xs">
          {bootstrap?.canEdit && <Button variant="light" color="teal" leftSection={<IconRefresh size={17} />} loading={historyBusy || Boolean(historySync && ["PENDING", "RUNNING", "IMPORTING"].includes(historySync.status))} onClick={syncHistory}>Atualizar conversas</Button>}
        {bootstrap?.canConfigureConnection && (
          <Button variant="subtle" leftSection={<IconBrandWhatsapp size={17} />} onClick={() => setConnectionSettingsOpened(true)}>
            Configurar WhatsApp
          </Button>
        )}
        </Group>}
      </header>

      {!connected ? <UazapiConnection compact onStatus={onConnectionStatus} /> : section === "INBOX" ? (
        <section className={styles.workspace}>
        <aside className={styles.views}>
          <div className={styles.filterSection}>
            <Text fw={800} size="xs" c="dimmed" mb="xs">CAIXAS</Text>
            <ViewButton active={view === "GENERAL"} icon={<IconUsers size={18} />} label="Caixa geral" count={stats?.facets?.view.GENERAL ?? stats?.general ?? 0} onClick={() => setView("GENERAL")} />
            <ViewButton active={view === "MINE"} icon={<IconMessageCircle size={18} />} label="Minha caixa" count={stats?.facets?.view.MINE ?? stats?.mine ?? 0} onClick={() => setView("MINE")} />
            <ViewButton active={view === "QUEUE"} icon={<IconInbox size={18} />} label="Fila de atendimento" count={stats?.facets?.view.QUEUE ?? stats?.queue ?? 0} onClick={() => setView("QUEUE")} />
          </div>
          <div className={styles.filterSection}>
            <Text fw={800} size="xs" c="dimmed" mb="xs">CONVERSAS</Text>
            <ViewButton active={chatKind === "ALL"} icon={<IconMessageCircle size={18} />} label="Todas" count={stats?.facets?.kind.ALL || 0} onClick={() => setChatKind("ALL")} />
            <ViewButton active={chatKind === "GROUP"} icon={<IconUsers size={18} />} label="Grupos" count={stats?.facets?.kind.GROUP || 0} onClick={() => setChatKind("GROUP")} />
            <ViewButton active={chatKind === "CONTACT"} icon={<IconMessageCircle size={18} />} label="Individuais" count={stats?.facets?.kind.CONTACT || 0} onClick={() => setChatKind("CONTACT")} />
          </div>
          <div className={styles.filterSection}>
            <Text fw={800} size="xs" c="dimmed" mb="xs">SITUAÇÃO</Text>
            <ViewButton active={chatStatus === "ALL"} icon={<IconMessageCircle size={18} />} label="Todas as situações" count={stats?.facets?.status.ALL || 0} onClick={() => setChatStatus("ALL")} />
            <ViewButton active={chatStatus === "OPEN"} icon={<IconInbox size={18} />} label="Em aberto" count={stats?.facets?.status.OPEN || 0} onClick={() => setChatStatus("OPEN")} />
            <ViewButton active={chatStatus === "RESOLVED"} icon={<IconCheck size={18} />} label="Finalizadas" count={stats?.facets?.status.RESOLVED || 0} onClick={() => setChatStatus("RESOLVED")} />
          </div>
        </aside>

        <div className={styles.listPanel}>
          <div className={styles.listHeader}>
            <Text fw={850} size="lg" mb="sm">Conversas</Text>
            <TextInput
              leftSection={<IconSearch size={16} />}
              placeholder="Buscar contato, cliente ou mensagem"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className={styles.search}
            />
            <Group gap={6} mt="sm"><Button size="compact-xs" radius="xl" variant={onlyUnread ? "light" : "subtle"} onClick={() => setOnlyUnread(value => !value)}>Não lidas</Button>{([{ value: "ALL", label: "Tudo" }, { value: "GROUP", label: "Grupos" }, { value: "CONTACT", label: "Individuais" }] as const).map(item => <Button key={item.value} size="compact-xs" radius="xl" variant={chatKind === item.value ? "light" : "subtle"} onClick={() => setChatKind(item.value)}>{item.label}</Button>)}</Group>
          </div>
          <div className={styles.ticketList}>
            {tickets.length ? (
              tickets.map((ticket) => (
                <button
                  type="button"
                  key={ticket.id}
                  className={`${styles.ticket} ${selectedId === ticket.id ? styles.ticketActive : ""}`}
                  onClick={() => { selectedRef.current = ticket.id; const cached = detailCache.current.get(ticket.id); setDetail(cached || null); setDetailLoading(!cached); setSelectedId(ticket.id); }}
                >
                  <ChatAvatar id={ticket.id} name={ticket.senderName || ticket.subject} group={ticket.channel.kind === "GROUP"} />
                  <div className={styles.ticketText}>
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={750} size="sm" truncate>{ticket.senderName || ticket.subject}</Text>
                      <Text size="xs" c="dimmed" className={styles.ticketDate}>{formatDate(ticket.lastMessageAt)}</Text>
                    </Group>
                    <Group justify="space-between" gap="xs" wrap="nowrap"><Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1 }}>{ticket.snippet || "Sem mensagem"}</Text>{Boolean(ticket.unreadCount) && <Badge circle color="teal" size="lg" aria-label={`${ticket.unreadCount} mensagens não lidas`}>{ticket.unreadCount! > 99 ? "99+" : ticket.unreadCount}</Badge>}</Group>
                    <Group gap={6} mt={6} wrap="nowrap">
                      <Badge size="xs" variant="light" color={ticket.status === "RESOLVED" ? "gray" : ticket.assignedTo ? "blue" : "orange"}>
                        {statusLabels[ticket.status] || ticket.status}
                      </Badge>
                      {ticket.client && <Text size="xs" c="dimmed" truncate>{ticket.client.name}</Text>}
                    </Group>
                  </div>
                </button>
              ))
            ) : (
              <div className={styles.emptyList}>
                <IconInbox size={34} />
                <Text fw={700}>Nenhuma conversa aqui</Text>
                <Text size="sm" c="dimmed">As mensagens recebidas pelo WhatsApp aparecerão aqui.</Text>
              </div>
            )}
          </div>
        </div>

        <div className={styles.detailPanel}>
          {detailLoading ? (
            <div className={styles.detailEmpty}><Loader size="sm" /></div>
          ) : selectedId && detail?.id === selectedId ? (
            <>
              <div className={styles.detailHeader}>
                <Group gap="sm" wrap="nowrap">
                <ChatAvatar id={detail.id} name={detail.senderName || detail.subject} group={detail.senderEmail.startsWith("wa-group:")} />
                <div>
                  <Group gap="xs">
                    <Text fw={850}>{detail.senderName || detail.subject}</Text>
                    <Badge size="sm" variant="light" color={detail.status === "RESOLVED" ? "gray" : "green"}>
                      {statusLabels[detail.status] || detail.status}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{detail.senderEmail.replace("wa-contact:", "+").replace("wa-group:", "Grupo: ")}</Text>
                </div>
                </Group>
                <Group gap="xs">
                  {detail.status !== "RESOLVED" && bootstrap?.canEdit && <Button size="xs" color="teal" variant="light" leftSection={<IconArrowRight size={15} />} disabled={saving || Boolean(detail.assignedTo && detail.assignedTo.id !== bootstrap.currentUser.id && !bootstrap.canManage)} onClick={() => setTransferOpened(true)}>Transferir</Button>}
                  {!detail.assignedTo && detail.status !== "RESOLVED" && (
                    <Button size="xs" variant="light" loading={saving} onClick={() => mutate({ action: "assign" }, "Atendimento assumido.")}>Assumir</Button>
                  )}
                  {detail.status !== "RESOLVED" && (
                    <Button size="xs" color="green" leftSection={<IconCheck size={15} />} loading={saving} onClick={() => mutate({ action: "finalize" }, "Atendimento finalizado.")}>Finalizar</Button>
                  )}
                </Group>
              </div>

              <div className={styles.contextBar}>
                <Select
                  label="Cliente vinculado"
                  placeholder="Selecione o cliente"
                  searchable
                  data={clientOptions}
                  value={detail.client?.id || null}
                  disabled={saving}
                  onChange={(clientId) => clientId && mutate({ action: "client", clientId }, "Cliente vinculado ao contato.")}
                />
                <Select
                  label="Assunto"
                  data={areaOptions}
                  value={detail.routingArea}
                  disabled={saving || detail.status === "RESOLVED"}
                  onChange={(routingArea) => routingArea && mutate({ action: "routingArea", routingArea }, "Área do atendimento atualizada.")}
                />
                  <div className={styles.contextInfo}>
                    <Text size="xs" c="dimmed">Responsável</Text>
                    <Text size="sm" fw={700}>{detail.assignedTo?.name || detail.assignedTo?.email || "Na fila"}</Text>
                  </div>
                <div className={styles.contextInfo}>
                  <Text size="xs" c="dimmed">Conta Azul</Text>
                  <Badge size="sm" color={detail.client?.contaAzulConnection?.active ? "green" : "gray"} variant="light">
                    {detail.client?.contaAzulConnection?.active ? "Conectado" : detail.client ? "Não conectado" : "Vincule o cliente"}
                  </Badge>
                </div>
              </div>

              <ChatMessages conversationId={detail.id} messages={detail.messages} senderName={detail.senderName || "Cliente"} hasOlder={detail.hasOlderMessages} loadingOlder={loadingOlder} onLoadOlder={loadOlderMessages} onRead={markRead} />

              {detail.status !== "RESOLVED" ? (
                <div className={styles.composer}>
                  <Textarea
                    autosize
                    minRows={2}
                    maxRows={5}
                    placeholder={bootstrap?.mode === "TEST" ? "Escreva uma resposta para registrar no teste..." : "Escreva uma resposta..."}
                    value={reply}
                    onChange={(event) => setReply(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendReply();
                      }
                    }}
                  />
                  <Tooltip label="Enviar resposta">
                    <ActionIcon size={44} radius="xl" color="green" loading={saving} disabled={!reply.trim()} onClick={sendReply}>
                      <IconSend size={19} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              ) : (
                <div className={styles.resolvedBar}>
                  <Text size="sm" fw={700}>Atendimento finalizado</Text>
                  <Group gap={5}>
                    <Text size="xs" c="dimmed">Registrar satisfação:</Text>
                    {[1, 2, 3, 4, 5].map((score) => (
                      <ActionIcon key={score} variant="subtle" color="yellow" onClick={() => mutate({ action: "satisfaction", score }, `Satisfação ${score}/5 registrada.`)}>
                        <IconStar size={17} />
                      </ActionIcon>
                    ))}
                  </Group>
                </div>
              )}
            </>
          ) : (
            <div className={styles.detailEmpty}>
              <IconBrandWhatsapp size={42} />
              <Text fw={800}>Selecione uma conversa</Text>
              <Text size="sm" c="dimmed">Os dados do cliente e o histórico aparecerão aqui.</Text>
            </div>
          )}
        </div>
        </section>
      ) : (
        <WhatsAppMonitoring
          clients={clientOptions}
          members={memberOptions}
          onOpenTicket={(id) => {
            setView("GENERAL");
            setSelectedId(id);
            setSection("INBOX");
          }}
        />
      )}

      {connected && detail?.id === selectedId && bootstrap && <WhatsAppTransferDialog key={detail.id + String(transferOpened)} opened={transferOpened} onClose={() => setTransferOpened(false)} onTransfer={(data) => mutate(data, "Atendimento transferido com histórico.")} clients={bootstrap.clients} operators={bootstrap.members} clientId={detail.client?.id || null} routingArea={detail.routingArea as "ACCOUNTS_PAYABLE" | "ACCOUNTS_RECEIVABLE" | "GENERAL" | "UNKNOWN"} saving={saving} />}

      <Modal opened={connectionSettingsOpened && connected} onClose={() => setConnectionSettingsOpened(false)} title="Configuração do WhatsApp" size="xl" centered><UazapiConnection onStatus={onConnectionStatus} /></Modal>

      <Modal opened={simulatorOpen && connected} onClose={() => setSimulatorOpen(false)} title="Simular mensagem recebida" centered size="lg">
        <Stack>
          <Paper p="md" radius="md" withBorder className={styles.testNotice}>
            <Text size="sm" fw={750}>Teste sem conectar o WhatsApp real</Text>
            <Text size="xs" c="dimmed">A mensagem passa pela mesma regra de vínculo, distribuição e reabertura que será usada na integração oficial.</Text>
          </Paper>
          <Select label="Origem da conversa" data={[{ value: "CONTACT", label: "Contato individual" }, { value: "GROUP", label: "Grupo" }]} value={simulation.kind} onChange={(kind) => setSimulation((current) => ({ ...current, kind: kind || "CONTACT" }))} />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label={simulation.kind === "GROUP" ? "Nome do grupo" : "Nome do contato"} placeholder="Ex.: Cliente XP" value={simulation.displayName} onChange={(event) => setSimulation((current) => ({ ...current, displayName: event.currentTarget.value }))} />
            <TextInput label={simulation.kind === "GROUP" ? "Identificador do grupo" : "Telefone com DDD"} placeholder={simulation.kind === "GROUP" ? "grupo-cliente-xp" : "+55 62 99999-0000"} value={simulation.identifier} onChange={(event) => setSimulation((current) => ({ ...current, identifier: event.currentTarget.value }))} />
          </SimpleGrid>
          <Select label="Cliente (opcional)" description="Use no primeiro teste para ensinar o vínculo. Depois, deixe vazio e confira o reconhecimento automático." placeholder="Deixar na fila para vincular depois" clearable searchable data={clientOptions} value={simulation.clientId || null} onChange={(clientId) => setSimulation((current) => ({ ...current, clientId: clientId || "" }))} />
          <Select label="Assunto percebido" data={areaOptions} value={simulation.routingArea} onChange={(routingArea) => setSimulation((current) => ({ ...current, routingArea: routingArea || "UNKNOWN" }))} />
          <Textarea label="Mensagem do cliente" minRows={4} placeholder="Ex.: Preciso conferir um pagamento que vence hoje." value={simulation.message} onChange={(event) => setSimulation((current) => ({ ...current, message: event.currentTarget.value }))} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setSimulatorOpen(false)}>Cancelar</Button>
            <Button color="green" leftSection={<IconBrandWhatsapp size={17} />} loading={saving} onClick={simulateMessage}>Receber mensagem</Button>
          </Group>
        </Stack>
      </Modal>
    </main>
  );
}

function ViewButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={active} className={`${styles.viewButton} ${active ? styles.viewActive : ""}`} onClick={onClick}>
      <span>{icon}{label}</span><Badge size="sm" variant={active ? "filled" : "light"}>{count}</Badge>
    </button>
  );
}
