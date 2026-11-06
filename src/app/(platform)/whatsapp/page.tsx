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
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconMaximize,
  IconMinimize,
  IconBrandWhatsapp,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
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
  IconNotes,
  IconLock,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatInfoDrawer } from "@/modules/whatsapp/chat-info-drawer";
import { WhatsAppDirectory } from "@/modules/whatsapp/directory-panel";
import { WhatsAppManagement } from "./management";
import { WhatsAppMonitoring } from "./monitoring";
import { UazapiConnection } from "@/modules/whatsapp/uazapi-connection";
import { mergeChatMessages } from "@/modules/whatsapp/message-pages";
import { ChatAvatar } from "@/modules/whatsapp/chat-avatar";
import { ChatMessages } from "@/modules/whatsapp/chat-messages";
import { WhatsAppTransferDialog } from "@/modules/whatsapp/transfer-dialog";
import { WhatsAppNotificationToggle } from "@/modules/whatsapp/notification-toggle";
import { WhatsAppQuickReplies } from "@/modules/whatsapp/quick-replies";
import { SaveWhatsAppContact } from "@/modules/whatsapp/save-contact";
import { inboxFacets, matchesInboxFilters, type InboxKind, type InboxStatus, type InboxView } from "@/modules/whatsapp/inbox-filters";
import styles from "./whatsapp.module.css";

type View = InboxView;
type Section = "INBOX" | "MONITORING" | "MANAGEMENT" | "DIRECTORY";

type Bootstrap = {
  accountKey: string | null;
  mode: string;
  currentUser: { id: string; name: string | null; email: string };
  canManage: boolean;
  canViewManagement: boolean;
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
  const [boxesMinimized,setBoxesMinimized] = useState(false);
  const [listMinimized,setListMinimized] = useState(false);
  const [contextMinimized,setContextMinimized] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [contactInfoId, setContactInfoId] = useState<string|null>(null);
  const [section, setSection] = useState<Section>("INBOX");
  const [view, setView] = useState<View>("GENERAL");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [chatKind, setChatKind] = useState<InboxKind>("ALL");
  const [chatStatus, setChatStatus] = useState<InboxStatus>("OPEN");
  const [transferOpened, setTransferOpened] = useState(false);
  const [inbox, setInbox] = useState<{ tickets: Ticket[]; complete: boolean; key: string }>({ tickets: [], complete: false, key: "" });
  const [baseStats, setStats] = useState<Stats | null>(null);
  const [managementSelection, setManagementSelection] = useState<string | null>(null);
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
  const [commentMode,setCommentMode]=useState(false),[comment,setComment]=useState(""),[quickRepliesOpened,setQuickRepliesOpened]=useState(false);
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
  // Opening a conversation is an explicit user action. List sorting/filtering and
  // unread updates must never replace the conversation currently being read.
  const selectedId = managementSelection || preferredId;
  useEffect(()=>{const timer=setTimeout(()=>{setCommentMode(false);setComment("");},0);return()=>clearTimeout(timer);},[selectedId]);
  const selectedRef = useRef<string | null>(null);
  const sendingReply = useRef(false);
  const detailCache = useRef(new Map<string, TicketDetail>());
  const lastRevision = useRef("");
  const accountKeyRef = useRef<string | null | undefined>(undefined);
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
  useEffect(() => {
    if (!focusMode) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusMode(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [focusMode]);

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
    if (messageId.startsWith("pending:") || selectedRef.current !== id || document.visibilityState !== "visible" || readMarkers.current.get(id) === messageId) return;
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
      .then(value => { accountKeyRef.current = value.accountKey; setBootstrap(value); })
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
        const state = await readResponse<{ revision: string; mode: string; accountKey: string | null; historySync: HistorySync | null }>(await fetch("/api/whatsapp/updates", { cache: "no-store", signal: controller.signal }));
        if (cancelled) return;
        if (accountKeyRef.current !== undefined && accountKeyRef.current !== state.accountKey || state.mode !== "CONNECTED") {
          listRequest.current++; detailRequest.current++; detailController.current?.abort();
          detailCache.current.clear(); ticketVersions.current.clear(); readMarkers.current.clear();
          partialList.current = false; lastRevision.current = ""; selectedRef.current = null;
          setInbox({ tickets: [], complete: false, key: "" }); setStats(null); setDetail(null);
          setSelectedId(null); setManagementSelection(null); setSection("INBOX"); setReply(""); setTransferOpened(false); setContactInfoId(null);
        }
        accountKeyRef.current = state.accountKey;
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

  useEffect(() => {
    const open = (href: string) => {
      const url = new URL(href, window.location.origin);
      const id = url.pathname === "/whatsapp" ? url.searchParams.get("ticket") : null;
      if (!id) return;
      setView("GENERAL"); setChatKind("ALL"); setChatStatus("ALL"); setOnlyUnread(false); setSearch("");
      setManagementSelection(id); selectedRef.current = id; setSelectedId(id);
      setDetail(detailCache.current.get(id) || null); setDetailLoading(!detailCache.current.has(id)); setSection("INBOX");
    };
    open(window.location.href);
    const listener = (event: Event) => { const href = (event as CustomEvent<{href?: string}>).detail?.href; if (href) open(href); };
    window.addEventListener("fortuno:notification-open", listener);
    return () => window.removeEventListener("fortuno:notification-open", listener);
  }, []);

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
      const next = {...payload.ticket, messages:mergeChatMessages((previous?.messages || []).filter(message => !message.id.startsWith("pending:")),payload.ticket.messages),hasOlderMessages:previous && previous.messages.length > payload.ticket.messages.length ? previous.hasOlderMessages : payload.ticket.hasOlderMessages};
      detailCache.current.set(id, next);
      if (selectedRef.current === id) setDetail(next);
      void loadList();
      if (action.action !== "reply") notifications.show({ color: "green", title: "Tudo certo", message: success });
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
    const content = (commentMode?comment:reply).trim(), id = selectedId;
    if (!content || !id || saving || sendingReply.current) return;
    sendingReply.current = true;
    if(commentMode)setComment("");else setReply("");
    const pendingId = "pending:" + crypto.randomUUID();
    const previous = detailCache.current.get(id) || detail;
    if (previous) {
      const optimistic: TicketDetail = {...previous, messages: [...previous.messages, {id: pendingId, direction: commentMode?"INTERNAL":"OUTBOUND", fromName: bootstrap?.currentUser.name || "Você", textBody: content, receivedAt: new Date().toISOString(), deliveryStatus: commentMode?null:"accepted", attachments: []}]};
      detailCache.current.set(id, optimistic);
      setDetail(optimistic);
    }
    try {
      const sent = await mutate({ action: commentMode?"comment":"reply", content }, commentMode?"Comentário interno salvo.":"Resposta enviada.");
      if (!sent) {
        const cached = detailCache.current.get(id);
        if (cached) {
          const failed = {...cached, messages: commentMode?cached.messages.filter(message=>message.id!==pendingId):cached.messages.map(message => message.id === pendingId ? {...message, deliveryStatus: "unconfirmed"} : message)};
          if(commentMode&&selectedRef.current===id)setComment(content);
          detailCache.current.set(id, failed);
          if (selectedRef.current === id) setDetail(failed);
        }
      }
    } finally { sendingReply.current = false; }
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
    <main className={`${styles.page} ${connected && section === "INBOX" ? styles.inboxPage : ""} ${focusMode && connected && section === "INBOX" ? styles.focusMode : ""}`}>
      <header className={styles.header}>
        <div>
          <Group gap="sm" align="center">
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
              <button type="button" className={section === "DIRECTORY" ? styles.sectionTabActive : ""} disabled={!connected} onClick={() => setSection("DIRECTORY")}><IconUsers size={18}/> Contatos e grupos</button>
              {bootstrap?.canViewManagement && <button type="button" className={section === "MANAGEMENT" ? styles.sectionTabActive : ""} onClick={() => setSection("MANAGEMENT")}><IconUsers size={18}/> Gestão</button>}
            </div>
            <Badge color={bootstrap?.mode === "CONNECTED" ? "green" : "yellow"} variant="light">
              {bootstrap?.mode === "CONNECTED" ? "Conectado" : "WhatsApp desconectado"}
            </Badge>
            {section === "INBOX" && syncError && <Text size="xs" c="orange">Reconectando atualização automática…</Text>}
            {bootstrap&&<WhatsAppNotificationToggle/>}
            {connected&&bootstrap?.canEdit&&<Button variant="subtle" size="xs" leftSection={<IconNotes size={16}/>} onClick={()=>setQuickRepliesOpened(true)}>Mensagens padrão</Button>}
            {connected && historySync && ["PENDING", "RUNNING", "IMPORTING"].includes(historySync.status) && <Badge color="teal" variant="light">Sincronizando histórico…</Badge>}
            {connected && historySync?.status === "FAILED" && <Text size="xs" c="orange">Histórico pendente de atualização</Text>}
          </Group>
        </div>
        {connected && section === "INBOX" && <Tooltip label={focusMode ? "Restaurar visualização" : "Ampliar central"}><ActionIcon className={styles.focusToggle} size="lg" variant="subtle" aria-label={focusMode ? "Restaurar visualização" : "Ampliar central"} aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)}>{focusMode ? <IconMinimize size={19}/> : <IconMaximize size={19}/>}</ActionIcon></Tooltip>}
      </header>

      {section === "MANAGEMENT" && bootstrap?.canViewManagement ? <WhatsAppManagement canEdit={Boolean(bootstrap.canEdit)} actions={<Group gap="xs">{connected && bootstrap.canEdit && <Button variant="light" color="teal" leftSection={<IconRefresh size={17}/>} loading={historyBusy} onClick={syncHistory}>Atualizar conversas</Button>}{bootstrap.canConfigureConnection && <Button variant="subtle" leftSection={<IconBrandWhatsapp size={17}/>} onClick={() => setConnectionSettingsOpened(true)}>Configurar WhatsApp</Button>}</Group>} onOpenTicket={(id) => { setView("GENERAL"); setChatKind("ALL"); setChatStatus("ALL"); setOnlyUnread(false); setSearch(""); setManagementSelection(id); selectedRef.current = id; setSelectedId(id); setDetail(detailCache.current.get(id) || null); setDetailLoading(!detailCache.current.has(id)); setSection("INBOX"); }} /> : !connected ? <UazapiConnection compact onStatus={onConnectionStatus} /> : section === "DIRECTORY" ? <WhatsAppDirectory canEdit={Boolean(bootstrap?.canEdit)} onOpenTicket={(id) => { setView("GENERAL"); setChatKind("ALL"); setChatStatus("ALL"); setOnlyUnread(false); setSearch(""); setManagementSelection(id); selectedRef.current = id; setSelectedId(id); setDetail(detailCache.current.get(id) || null); setDetailLoading(!detailCache.current.has(id)); setSection("INBOX"); }} /> : section === "INBOX" ? (
        <section data-whatsapp-workspace className={`${styles.workspace} ${boxesMinimized ? styles.boxesMinimized : ""} ${listMinimized ? styles.listMinimized : ""}`}>
        <aside className={styles.views} aria-label="Caixas e filtros">
          <Group justify="space-between" wrap="nowrap" className={styles.panelHeading}>{!boxesMinimized&&<Text fw={800} size="xs" c="dimmed">CAIXAS</Text>}<Tooltip label={boxesMinimized?"Abrir caixas":"Recolher caixas"}><ActionIcon variant="subtle" color="gray" aria-label={boxesMinimized?"Abrir caixas":"Recolher caixas"} aria-expanded={!boxesMinimized} aria-controls="whatsapp-boxes-content" onClick={()=>setBoxesMinimized(value=>!value)}>{boxesMinimized?<IconChevronRight size={17}/>:<IconChevronLeft size={17}/>}</ActionIcon></Tooltip></Group>
          {boxesMinimized&&<span className={styles.railLabel}>Caixas</span>}
          <div id="whatsapp-boxes-content" className={styles.boxesContent}>
          <div className={styles.filterSection}>
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
          </div></div>
        </aside>

        <div className={styles.listPanel} aria-label="Lista de conversas">
          <Group justify="space-between" wrap="nowrap" className={styles.listHeading}>{!listMinimized&&<Text fw={850} size="md">Conversas</Text>}<Tooltip label={listMinimized?"Abrir lista de conversas":"Recolher lista de conversas"}><ActionIcon variant="subtle" color="gray" aria-label={listMinimized?"Abrir lista de conversas":"Recolher lista de conversas"} aria-expanded={!listMinimized} aria-controls="whatsapp-list-content" onClick={()=>setListMinimized(value=>!value)}>{listMinimized?<IconChevronRight size={17}/>:<IconChevronLeft size={17}/>}</ActionIcon></Tooltip></Group>
          {listMinimized&&<span className={styles.railLabel}>Conversas</span>}
          <div id="whatsapp-list-content" className={styles.listContent}>
          <div className={styles.listHeader}>
            <TextInput
              leftSection={<IconSearch size={16} />}
              placeholder="Buscar contato, cliente ou mensagem"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className={styles.search}
            />
            <div className={styles.conversationFilters} aria-label="Filtrar conversas">
              <button type="button" aria-pressed={onlyUnread} className={onlyUnread ? styles.conversationFilterActive : undefined} onClick={() => { setSelectedId(null); setOnlyUnread(value => !value); }}>Não lidas</button>
              {([{ value: "ALL", label: "Tudo" }, { value: "GROUP", label: "Grupos" }, { value: "CONTACT", label: "Individuais" }] as const).map(item => <button type="button" key={item.value} aria-pressed={chatKind === item.value} className={chatKind === item.value ? styles.conversationFilterActive : undefined} onClick={() => setChatKind(item.value)}>{item.label}</button>)}
            </div>
          </div>
          <div className={styles.ticketList}>
            {tickets.length ? (
              tickets.map((ticket) => (
                <button
                  type="button"
                  key={ticket.id}
                  className={`${styles.ticket} ${selectedId === ticket.id ? styles.ticketActive : ""}`}
                  onClick={() => { setManagementSelection(null); selectedRef.current = ticket.id; const cached = detailCache.current.get(ticket.id); setDetail(cached || null); setDetailLoading(!cached); setSelectedId(ticket.id); }}
                >
                  <ChatAvatar id={ticket.id} name={ticket.senderName || ticket.subject} group={ticket.channel.kind === "GROUP"} />
                  <div className={styles.ticketText}>
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={750} size="sm" truncate>{ticket.senderName || ticket.subject}</Text>
                      <Text size="xs" c="dimmed" className={styles.ticketDate}>{formatDate(ticket.lastMessageAt)}</Text>
                    </Group>
                    <Group justify="space-between" gap="xs" wrap="nowrap"><Text size="xs" c="dimmed" lineClamp={1} style={{ flex: 1 }}>{ticket.lastDirection === "OUTBOUND" ? "Você: " : ""}{ticket.snippet || "Sem mensagem"}</Text>{Boolean(ticket.unreadCount) && <Badge circle color="teal" size="lg" aria-label={`${ticket.unreadCount} mensagens não lidas`}>{ticket.unreadCount! > 99 ? "99+" : ticket.unreadCount}</Badge>}</Group>
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
          </div></div>
        </div>

        <div className={styles.detailPanel}>
          {detailLoading ? (
            <div className={styles.detailEmpty}><Loader size="sm" /></div>
          ) : selectedId && detail?.id === selectedId ? (
            <>
              <div className={styles.detailHeader}>
                {bootstrap?.canEdit&&/^wa-contact:\d+$/.test(detail.senderEmail)&&<SaveWhatsAppContact key={detail.id} compact initialName={detail.senderName||""} initialNumber={detail.senderEmail.slice(11)} onSaved={()=>{void loadList();}}/>}
                <UnstyledButton onClick={() => setContactInfoId(detail.id)} aria-label="Ver informações da conversa"><Group gap="sm" wrap="nowrap">
                <ChatAvatar id={detail.id} name={detail.senderName || detail.subject} group={detail.senderEmail.startsWith("wa-group:")} />
                <div>
                  <Group gap="xs">
                    <Text fw={850}>{detail.senderName || detail.subject}</Text>
                    <Badge size="sm" variant="light" color={detail.status === "RESOLVED" ? "gray" : "green"}>
                      {statusLabels[detail.status] || detail.status}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed" title={detail.senderEmail.replace("wa-contact:", "+").replace("wa-group:", "Grupo: ")}>{areaOptions.find(area => area.value === detail.routingArea)?.label || "Triagem"} · {detail.assignedTo?.name || "Na fila"}</Text>
                </div>
                </Group></UnstyledButton>
                <Group gap="xs"><Tooltip label={contextMinimized?"Mostrar dados do atendimento":"Recolher dados do atendimento"}><ActionIcon variant="subtle" color="gray" aria-label={contextMinimized?"Mostrar dados do atendimento":"Recolher dados do atendimento"} aria-expanded={!contextMinimized} aria-controls="whatsapp-context" onClick={()=>setContextMinimized(value=>!value)}>{contextMinimized?<IconChevronDown size={17}/>:<IconChevronUp size={17}/>}</ActionIcon></Tooltip>
                  {detail.status !== "RESOLVED" && bootstrap?.canEdit && <Button size="xs" color="teal" variant="light" leftSection={<IconArrowRight size={15} />} disabled={saving || Boolean(detail.assignedTo && detail.assignedTo.id !== bootstrap.currentUser.id && !bootstrap.canManage)} onClick={() => setTransferOpened(true)}>Transferir</Button>}
                  {!detail.assignedTo && detail.status !== "RESOLVED" && (
                    <Button size="xs" variant="light" loading={saving} onClick={() => mutate({ action: "assign" }, "Atendimento assumido.")}>Assumir</Button>
                  )}
                  {detail.status !== "RESOLVED" && (
                    <Button size="xs" color="green" leftSection={<IconCheck size={15} />} loading={saving} onClick={() => mutate({ action: "finalize" }, "Atendimento finalizado.")}>Finalizar</Button>
                  )}
                </Group>
              </div>

              <div id="whatsapp-context" className={styles.contextBar} hidden={contextMinimized}>
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

              {(detail.status !== "RESOLVED"||commentMode) ? (
                <div className={`${styles.composer} ${commentMode?styles.commentComposer:""}`}>
                  <div className={styles.composerTools}><Tooltip label="Mensagens padrão"><ActionIcon variant="subtle" aria-label="Abrir mensagens padrão" disabled={!bootstrap?.canEdit} onClick={()=>setQuickRepliesOpened(true)}><IconNotes size={19}/></ActionIcon></Tooltip><Tooltip label={commentMode?"Voltar a responder ao cliente":"Adicionar comentário interno"}><ActionIcon variant={commentMode?"light":"subtle"} color={commentMode?"yellow":"gray"} aria-label={commentMode?"Voltar a responder ao cliente":"Adicionar comentário interno"} aria-pressed={commentMode} disabled={saving||!bootstrap?.canEdit} onClick={()=>setCommentMode(v=>!v)}><IconLock size={18}/></ActionIcon></Tooltip></div>
                  <Textarea
                    autosize
                    minRows={1}
                    maxRows={5}
                    aria-label={commentMode?"Comentário interno":"Mensagem para o cliente"}
                    description={commentMode?"Comentário interno · somente a equipe vê · não enviado ao cliente":undefined}
                    placeholder={commentMode?"Escreva um comentário para a equipe...":"Escreva uma resposta..."}
                    value={commentMode?comment:reply}
                    maxLength={5000}
                    disabled={!bootstrap?.canEdit||Boolean(detail.assignedTo&&detail.assignedTo.id!==bootstrap.currentUser.id&&!bootstrap.canManage)}
                    onChange={(event) => commentMode?setComment(event.currentTarget.value):setReply(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendReply();
                      }
                    }}
                  />
                  <Tooltip label={commentMode?"Salvar comentário interno":"Enviar resposta"}>
                    <ActionIcon aria-label={commentMode?"Salvar comentário interno":"Enviar resposta"} size={44} radius="xl" color={commentMode?"yellow":"green"} loading={saving} disabled={!(commentMode?comment:reply).trim()||!bootstrap?.canEdit||Boolean(detail.assignedTo&&detail.assignedTo.id!==bootstrap.currentUser.id&&!bootstrap.canManage)} onClick={sendReply}>
                      <IconSend size={19} />
                    </ActionIcon>
                  </Tooltip>
                </div>
              ) : (
                <div className={styles.resolvedBar}>
                  <Text size="sm" fw={700}>Atendimento finalizado</Text>
                  {bootstrap?.canEdit&&<Button variant="subtle" size="xs" leftSection={<IconLock size={15}/>} onClick={()=>setCommentMode(true)}>Comentário interno</Button>}
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
            setManagementSelection(null);
            setView("GENERAL");
            setSelectedId(id);
            setSection("INBOX");
          }}
        />
      )}

      {contactInfoId && detail?.id === contactInfoId && selectedId === contactInfoId && <ChatInfoDrawer key={contactInfoId} id={contactInfoId} name={detail.senderName || detail.subject} group={detail.senderEmail.startsWith("wa-group:")} onClose={() => setContactInfoId(null)}/>}
      {connected && bootstrap && <WhatsAppQuickReplies key={bootstrap.accountKey} opened={quickRepliesOpened} onClose={()=>setQuickRepliesOpened(false)} onInsert={text=>{setCommentMode(false);setReply(text);setSection("INBOX");}} onSent={()=>{void loadList();}} scope={bootstrap.currentUser.id+":"+bootstrap.accountKey} canEdit={bootstrap.canEdit}/>}
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
      <span>{icon}{label}</span><Badge size="sm" title={String(count)} variant={active ? "filled" : "light"}>{count > 999 ? new Intl.NumberFormat("pt-BR",{notation:"compact",maximumFractionDigits:1}).format(count) : count}</Badge>
    </button>
  );
}
