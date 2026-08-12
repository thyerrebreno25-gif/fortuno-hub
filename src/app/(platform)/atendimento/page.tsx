"use client";

import {
  Alert,
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Modal,
  Paper,
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
  IconAlertTriangle,
  IconArrowBackUp,
  IconCircleCheck,
  IconClock,
  IconInbox,
  IconMail,
  IconMessage,
  IconSearch,
  IconSend,
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
} from "react";
import styles from "./atendimento.module.css";

type Any = Record<string, any>;

const views = [
  ["GENERAL", "Caixa Geral", "general", IconInbox],
  ["MINE", "Minha Caixa", "mine", IconUser],
  ["UNASSIGNED", "Não atribuídos", "unassigned", IconUsers],
  ["WAITING", "Aguardando", "waiting", IconClock],
  ["RESOLVED", "Resolvidos", "resolved", IconCircleCheck],
  ["SPAM", "Spam", "spam", IconTrash],
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
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [narrow, setNarrow] = useState(false);

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

  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= 1180);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const loadBootstrap = useCallback(async () => {
    const response = await fetch("/api/atendimento/bootstrap", {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Erro ao carregar Central.");
    setBootstrap(body);
  }, []);

  const loadTickets = useCallback(async () => {
    const query = new URLSearchParams({ view });
    if (search.trim()) query.set("search", search.trim());

    const response = await fetch(
      `/api/atendimento?${query.toString()}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Erro ao carregar chamados.");
    setTickets(body.tickets || []);
    setStats(body.stats || {});
  }, [view, search]);

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all([loadBootstrap(), loadTickets()]);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Erro ao carregar Central.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadBootstrap, loadTickets]);

  const openTicket = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/atendimento/${id}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao abrir chamado.");
      setSelected(body.ticket);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível abrir o chamado.",
      );
    } finally {
      setDetailLoading(false);
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

  const detail = selected ? (
    <TicketDetail
      ticket={selected}
      bootstrap={bootstrap}
      saving={saving}
      note={note}
      setNote={setNote}
      updateTicket={updateTicket}
      memberOptions={memberOptions}
      clientOptions={clientOptions}
    />
  ) : null;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={3}>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>
            Fortuno Hub
          </Text>
          <Title order={2}>Central de Atendimento</Title>
          <Text c="dimmed">
            Caixa geral, distribuição por colaborador e acompanhamento até a resolução.
          </Text>
        </Stack>

        <Group>
          <Badge size="lg" variant="light" leftSection={<IconSparkles size={13} />}>
            V1 · Gmail na próxima etapa
          </Badge>

          {bootstrap.permission?.canCreate && (
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

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <Stack gap={6}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase" px={8} py={6}>
              Caixas
            </Text>

            {views.map(([value, label, stat, Icon]) => (
              <Button
                key={value}
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
                  setSelected(null);
                  setSelectedId(null);
                }}
              >
                {label}
              </Button>
            ))}
          </Stack>
        </aside>

        <section className={styles.list}>
          <div
            style={{
              padding: 14,
              borderBottom: "1px solid var(--mantine-color-gray-2)",
            }}
          >
            <TextInput
              placeholder="Buscar cliente, assunto ou remetente..."
              leftSection={<IconSearch size={16} />}
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </div>

          <ScrollArea h={610}>
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
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Text size="sm" fw={800} lineClamp={1}>
                      {ticket.client?.name ||
                        ticket.senderName ||
                        ticket.senderEmail}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                      {formatDate(ticket.lastMessageAt)}
                    </Text>
                  </Group>

                  <Text size="sm" fw={600} mt={4} lineClamp={1}>
                    {ticket.subject}
                  </Text>

                  <Text size="xs" c="dimmed" mt={3} lineClamp={2}>
                    {ticket.snippet || ticket.senderEmail}
                  </Text>

                  <Group gap={6} mt={9}>
                    <Badge
                      size="xs"
                      color={statusColors[ticket.status] || "gray"}
                      variant="light"
                    >
                      {statusLabels[ticket.status] || ticket.status}
                    </Badge>

                    {!ticket.assignedTo ? (
                      <Badge size="xs" color="orange" variant="light">
                        Sem responsável
                      </Badge>
                    ) : (
                      <Badge size="xs" variant="outline">
                        {ticket.assignedTo.name || ticket.assignedTo.email}
                      </Badge>
                    )}
                  </Group>
                </div>
              ))
            )}
          </ScrollArea>
        </section>

        <section className={styles.detail}>
          {!selectedId ? (
            <Stack align="center" justify="center" h="100%" gap="sm" px="xl">
              <ThemeIcon size={60} radius="xl" variant="light">
                <IconMessage size={28} />
              </ThemeIcon>
              <Text fw={800}>Selecione um chamado</Text>
              <Text size="sm" c="dimmed" ta="center">
                Abra uma mensagem para acompanhar atendimento, responsável e histórico.
              </Text>
            </Stack>
          ) : detailLoading ? (
            <Group justify="center" py={80}>
              <Loader />
            </Group>
          ) : (
            detail
          )}
        </section>
      </div>

      <Drawer
        opened={narrow && Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setSelectedId(null);
        }}
        position="right"
        size="xl"
        title={selected?.subject}
      >
        {detail}
      </Drawer>

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

function TicketDetail({
  ticket,
  bootstrap,
  saving,
  note,
  setNote,
  updateTicket,
  memberOptions,
  clientOptions,
}: {
  ticket: Any;
  bootstrap: Any;
  saving: boolean;
  note: string;
  setNote: (value: string) => void;
  updateTicket: (action: string, payload?: Any) => Promise<boolean>;
  memberOptions: Any[];
  clientOptions: Any[];
}) {
  const canManage = bootstrap.currentUser.canManage;

  return (
    <ScrollArea h={660}>
      <Stack p="lg" gap="lg">
        <Stack gap={5}>
          <Group justify="space-between" align="flex-start">
            <div>
              <Text size="xs" c="dimmed" fw={700}>
                {ticket.senderName || ticket.senderEmail}
              </Text>
              <Title order={3} mt={3}>
                {ticket.subject}
              </Title>
            </div>
            <Badge size="lg" color={statusColors[ticket.status] || "gray"}>
              {statusLabels[ticket.status] || ticket.status}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            De: {ticket.senderEmail} · Recebido em {formatDate(ticket.receivedAt)}
          </Text>
        </Stack>

        <Paper withBorder radius="md" p="md">
          <Stack gap="sm">
            <Group grow align="flex-start">
              <Select
                label="Cliente"
                clearable
                searchable
                disabled={!canManage}
                data={clientOptions}
                value={ticket.client?.id || null}
                onChange={(value) =>
                  void updateTicket("client", { clientId: value })
                }
              />
              <Select
                label="Responsável"
                clearable
                searchable
                disabled={!canManage}
                data={memberOptions}
                value={ticket.assignedTo?.id || null}
                onChange={(value) =>
                  void updateTicket("assign", { assignedToId: value })
                }
              />
            </Group>

            <Select
              label="Prioridade"
              data={[
                { value: "LOW", label: "Baixa" },
                { value: "MEDIUM", label: "Média" },
                { value: "HIGH", label: "Alta" },
                { value: "CRITICAL", label: "Crítica" },
              ]}
              value={ticket.priority}
              onChange={(value) =>
                value && void updateTicket("priority", { priority: value })
              }
            />
          </Stack>
        </Paper>

        {!ticket.assignedTo && (
          <Button
            variant="light"
            leftSection={<IconUser size={16} />}
            loading={saving}
            onClick={() =>
              void updateTicket("assign", {
                assignedToId: bootstrap.currentUser.id,
              })
            }
          >
            Assumir chamado
          </Button>
        )}

        <Divider label="Conversa" labelPosition="left" />

        <Stack>
          {ticket.messages?.map((message: Any) => (
            <Paper
              key={message.id}
              withBorder
              radius="lg"
              p="md"
              bg={message.direction === "INTERNAL" ? "yellow.0" : "gray.0"}
            >
              <Group justify="space-between" mb={8}>
                <Text size="sm" fw={800}>
                  {message.direction === "INTERNAL"
                    ? "Observação interna"
                    : message.fromName || message.fromEmail}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatDate(message.receivedAt)}
                </Text>
              </Group>
              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                {message.textBody || "Mensagem sem conteúdo em texto."}
              </Text>
            </Paper>
          ))}
        </Stack>

        <Paper withBorder radius="md" p="md">
          <Stack gap="sm">
            <Textarea
              label="Observação interna"
              description="Ainda não envia resposta ao Gmail."
              minRows={3}
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button
                variant="light"
                leftSection={<IconSend size={15} />}
                disabled={!note.trim()}
                loading={saving}
                onClick={async () => {
                  const ok = await updateTicket("note", { content: note });
                  if (ok) setNote("");
                }}
              >
                Registrar observação
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Divider label="Ações" labelPosition="left" />

        <Group>
          {ticket.status !== "IN_PROGRESS" &&
            ticket.status !== "RESOLVED" &&
            ticket.status !== "SPAM" && (
              <Button
                variant="light"
                onClick={() =>
                  void updateTicket("status", { status: "IN_PROGRESS" })
                }
              >
                Em atendimento
              </Button>
            )}

          <Button
            variant="light"
            color="yellow"
            onClick={() =>
              void updateTicket("status", { status: "WAITING_CUSTOMER" })
            }
          >
            Aguardando cliente
          </Button>

          <Button
            variant="light"
            color="orange"
            onClick={() =>
              void updateTicket("status", { status: "WAITING_INTERNAL" })
            }
          >
            Aguardando interno
          </Button>

          {ticket.status !== "RESOLVED" ? (
            <Button
              color="green"
              leftSection={<IconCircleCheck size={16} />}
              onClick={() =>
                void updateTicket("status", { status: "RESOLVED" })
              }
            >
              Resolver
            </Button>
          ) : (
            <Button
              variant="light"
              leftSection={<IconArrowBackUp size={16} />}
              onClick={() =>
                void updateTicket("status", { status: "IN_PROGRESS" })
              }
            >
              Reabrir
            </Button>
          )}

          {ticket.status !== "SPAM" ? (
            <Button
              color="gray"
              variant="outline"
              leftSection={<IconAlertTriangle size={16} />}
              onClick={() =>
                void updateTicket("status", { status: "SPAM" })
              }
            >
              Marcar como spam
            </Button>
          ) : (
            <Button
              variant="light"
              onClick={() => void updateTicket("status", { status: "NEW" })}
            >
              Não é spam
            </Button>
          )}
        </Group>

        {ticket.history?.length > 0 && (
          <>
            <Divider label="Histórico" labelPosition="left" />
            <Stack gap="xs">
              {ticket.history.map((item: Any) => (
                <Group key={item.id} align="flex-start" wrap="nowrap">
                  <ThemeIcon size={28} radius="xl" variant="light">
                    <IconClock size={14} />
                  </ThemeIcon>
                  <div>
                    <Text size="sm" fw={600}>
                      {item.message}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {item.user?.name || item.user?.email || "Sistema"} ·{" "}
                      {formatDate(item.createdAt)}
                    </Text>
                  </div>
                </Group>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </ScrollArea>
  );
}
