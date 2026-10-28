"use client";

import {
  ActionIcon,
  Avatar,
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
  IconChartBar,
  IconCheck,
  IconInbox,
  IconMessageCircle,
  IconPaperclip,
  IconSearch,
  IconSend,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WhatsAppMonitoring } from "./monitoring";
import { UazapiConnection } from "@/modules/whatsapp/uazapi-connection";
import styles from "./whatsapp.module.css";

type View = "GENERAL" | "MINE" | "QUEUE";
type Section = "INBOX" | "MONITORING" | "CONNECTION";

type Bootstrap = {
  mode: string;
  currentUser: { id: string; name: string | null; email: string };
  canManage: boolean;
  clients: Array<{
    id: string;
    name: string;
    document: string | null;
    contaAzulConnection: {
      status: string;
      active: boolean;
      externalTenantName: string | null;
    } | null;
  }>;
  members: Array<{ id: string; name: string | null; email: string; role: string }>;
};

type Ticket = {
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

const deliveryLabels: Record<string, string> = {
  accepted: "Enviando",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falha no envio",
};

async function readResponse<T>(response: Response) {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a ação.");
  return payload;
}

export default function WhatsAppPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [section, setSection] = useState<Section>("INBOX");
  const onConnectionStatus = useCallback((status: string) => setBootstrap((value) => value ? { ...value, mode: status } : value), []);
  const [view, setView] = useState<View>("GENERAL");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [simulation, setSimulation] = useState({
    kind: "CONTACT",
    displayName: "",
    identifier: "",
    message: "",
    routingArea: "UNKNOWN",
    clientId: "",
  });

  const loadList = useCallback(async () => {
    const params = new URLSearchParams({ view });
    if (search.trim()) params.set("search", search.trim());
    const payload = await readResponse<{ tickets: Ticket[]; stats: Stats }>(
      await fetch(`/api/whatsapp?${params}`, { cache: "no-store" }),
    );
    setTickets(payload.tickets);
    setStats(payload.stats);
    setSelectedId((current) =>
      current && payload.tickets.some((ticket) => ticket.id === current)
        ? current
        : payload.tickets[0]?.id || null,
    );
  }, [search, view]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const payload = await readResponse<{ ticket: TicketDetail }>(
        await fetch(`/api/whatsapp/${id}`, { cache: "no-store" }),
      );
      setDetail(payload.ticket);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Central WhatsApp",
        message: error instanceof Error ? error.message : "Não foi possível abrir a conversa.",
      });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/whatsapp/bootstrap", { cache: "no-store" }).then((response) =>
        readResponse<Bootstrap>(response),
      ),
      // A lista remota é sincronizada quando filtros ou caixa mudam.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadList(),
    ])
      .then(([base]) => setBootstrap(base))
      .catch((error) =>
        notifications.show({
          color: "red",
          title: "Central WhatsApp",
          message: error instanceof Error ? error.message : "Não foi possível carregar o módulo.",
        }),
      )
      .finally(() => setLoading(false));
  }, [loadList]);

  useEffect(() => {
    if (selectedId) {
      // O detalhe remoto acompanha a conversa selecionada.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadDetail(selectedId);
    }
  }, [loadDetail, selectedId]);

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

  async function mutate(action: Record<string, unknown>, success: string) {
    if (!selectedId) return;
    setSaving(true);
    try {
      const payload = await readResponse<{ ticket: TicketDetail }>(
        await fetch(`/api/whatsapp/${selectedId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        }),
      );
      setDetail(payload.ticket);
      await loadList();
      notifications.show({ color: "green", title: "Tudo certo", message: success });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Não foi possível concluir",
        message: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function sendReply() {
    const content = reply.trim();
    if (!content) return;
    await mutate(
      { action: "reply", content },
      detail?.source === "WHATSAPP_API"
        ? "Resposta enviada pelo WhatsApp."
        : "Resposta registrada no teste.",
    );
    setReply("");
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
              <button type="button" className={section === "CONNECTION" ? styles.sectionTabActive : ""} onClick={() => setSection("CONNECTION")}>Conexão Uazapi</button>
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
                onClick={() => setSection("MONITORING")}
              >
                <IconChartBar size={18} /> Central de monitoramento
              </button>
            </div>
            <Badge color={bootstrap?.mode === "CONNECTED" ? "green" : "yellow"} variant="light">
              {bootstrap?.mode === "CONNECTED" ? "Conectado" : "WhatsApp desconectado"}
            </Badge>
          </Group>
        </div>
        {section === "INBOX" && (
          <Button leftSection={<IconBrandWhatsapp size={17} />} onClick={() => setSection("CONNECTION")}>
            Gerenciar conexão
          </Button>
        )}
      </header>

      {section === "CONNECTION" ? <UazapiConnection onStatus={onConnectionStatus} /> : section === "INBOX" ? (
        <section className={styles.workspace}>
        <aside className={styles.views}>
          <Text fw={800} size="sm" mb="sm">Conversas</Text>
          <ViewButton active={view === "GENERAL"} icon={<IconUsers size={18} />} label="Caixa geral" count={stats?.general || 0} onClick={() => setView("GENERAL")} />
          <ViewButton active={view === "MINE"} icon={<IconMessageCircle size={18} />} label="Minha caixa" count={stats?.mine || 0} onClick={() => setView("MINE")} />
          <ViewButton active={view === "QUEUE"} icon={<IconInbox size={18} />} label="Fila de atendimento" count={stats?.queue || 0} onClick={() => setView("QUEUE")} />
          <div className={styles.helpBox}>
            <IconBrandWhatsapp size={22} />
            <Text fw={750} size="sm">Distribuição inteligente</Text>
            <Text size="xs" c="dimmed">Ao vincular um contato, as próximas conversas reconhecem o cliente e seus responsáveis.</Text>
          </div>
        </aside>

        <div className={styles.listPanel}>
          <div className={styles.listHeader}>
            <TextInput
              leftSection={<IconSearch size={16} />}
              placeholder="Buscar contato, cliente ou mensagem"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              className={styles.search}
            />
          </div>
          <div className={styles.ticketList}>
            {tickets.length ? (
              tickets.map((ticket) => (
                <button
                  type="button"
                  key={ticket.id}
                  className={`${styles.ticket} ${selectedId === ticket.id ? styles.ticketActive : ""}`}
                  onClick={() => setSelectedId(ticket.id)}
                >
                  <Avatar color={ticket.channel.kind === "GROUP" ? "violet" : "green"} radius="xl">
                    {ticket.channel.kind === "GROUP" ? <IconUsers size={18} /> : (ticket.senderName || "?").slice(0, 1).toUpperCase()}
                  </Avatar>
                  <div className={styles.ticketText}>
                    <Group justify="space-between" gap="xs" wrap="nowrap">
                      <Text fw={750} size="sm" truncate>{ticket.senderName || ticket.subject}</Text>
                      <Text size="xs" c="dimmed" className={styles.ticketDate}>{formatDate(ticket.lastMessageAt)}</Text>
                    </Group>
                    <Text size="xs" c="dimmed" lineClamp={1}>{ticket.snippet || "Sem mensagem"}</Text>
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
                <Text size="sm" c="dimmed">Conecte o WhatsApp na aba Conexão Uazapi para receber mensagens.</Text>
              </div>
            )}
          </div>
        </div>

        <div className={styles.detailPanel}>
          {detailLoading ? (
            <div className={styles.detailEmpty}><Loader size="sm" /></div>
          ) : selectedId && detail ? (
            <>
              <div className={styles.detailHeader}>
                <div>
                  <Group gap="xs">
                    <Text fw={850}>{detail.senderName || detail.subject}</Text>
                    <Badge size="sm" variant="light" color={detail.status === "RESOLVED" ? "gray" : "green"}>
                      {statusLabels[detail.status] || detail.status}
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{detail.senderEmail.replace("wa-contact:", "+").replace("wa-group:", "Grupo: ")}</Text>
                </div>
                <Group gap="xs">
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
                {bootstrap?.canManage ? (
                  <Select
                    label="Responsável"
                    placeholder="Na fila"
                    searchable
                    data={memberOptions}
                    value={detail.assignedTo?.id || null}
                    disabled={saving || detail.status === "RESOLVED"}
                    onChange={(assignedToId) => assignedToId && mutate({ action: "assign", assignedToId }, "Responsável atualizado.")}
                  />
                ) : (
                  <div className={styles.contextInfo}>
                    <Text size="xs" c="dimmed">Responsável</Text>
                    <Text size="sm" fw={700}>{detail.assignedTo?.name || detail.assignedTo?.email || "Na fila"}</Text>
                  </div>
                )}
                <div className={styles.contextInfo}>
                  <Text size="xs" c="dimmed">Conta Azul</Text>
                  <Badge size="sm" color={detail.client?.contaAzulConnection?.active ? "green" : "gray"} variant="light">
                    {detail.client?.contaAzulConnection?.active ? "Conectado" : detail.client ? "Não conectado" : "Vincule o cliente"}
                  </Badge>
                </div>
              </div>

              <div className={styles.messages}>
                {detail.messages.map((message) => (
                  <div key={message.id} className={`${styles.messageRow} ${message.direction === "OUTBOUND" ? styles.outbound : message.direction === "INTERNAL" ? styles.internal : ""}`}>
                    <div className={styles.bubble}>
                      <Text size="xs" fw={800} mb={4}>{message.direction === "OUTBOUND" ? message.fromName || "Fortuno" : detail.senderName || "Cliente"}</Text>
                      <Text size="sm" className={styles.messageBody}>{message.textBody || "Mensagem sem texto"}</Text>
                      {message.attachments?.map((attachment) => (
                        <Button
                          key={attachment.id}
                          component="a"
                          href={`/api/whatsapp/${detail.id}/attachments/${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          variant="light"
                          color="gray"
                          size="compact-xs"
                          mt="xs"
                          leftSection={<IconPaperclip size={14} />}
                        >
                          {attachment.name}
                        </Button>
                      ))}
                      <Group justify="flex-end" gap={6} mt={5}>
                        {message.direction === "OUTBOUND" && message.deliveryStatus && (
                          <Text size="xs" c={message.deliveryStatus === "failed" ? "red" : "dimmed"}>
                            {deliveryLabels[message.deliveryStatus] || message.deliveryStatus}
                          </Text>
                        )}
                        <Text size="xs" c="dimmed">{formatDate(message.receivedAt)}</Text>
                      </Group>
                    </div>
                  </div>
                ))}
              </div>

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

      <Modal opened={simulatorOpen} onClose={() => setSimulatorOpen(false)} title="Simular mensagem recebida" centered size="lg">
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
    <button type="button" className={`${styles.viewButton} ${active ? styles.viewActive : ""}`} onClick={onClick}>
      <span>{icon}{label}</span><Badge size="sm" variant={active ? "filled" : "light"}>{count}</Badge>
    </button>
  );
}
