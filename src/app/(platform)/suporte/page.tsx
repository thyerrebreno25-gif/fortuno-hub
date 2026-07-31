"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconFile,
  IconMessageCircle,
  IconPaperclip,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconTicket,
  IconTrash,
} from "@tabler/icons-react";

type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
type TicketPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Attachment = {
  name: string;
  size: number;
  type: string;
};

type TicketListItem = {
  id: string;
  code: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  category: string;
  module: string;
  attachments: Attachment[];
  messageCount: number;
  requester: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
};

type TicketMessage = {
  id: string;
  userId: string;
  userName: string;
  senderType: "USER" | "SUPPORT";
  text: string;
  createdAt: string;
  attachments?: Attachment[];
};

type TicketDetail = TicketListItem & {
  messages: TicketMessage[];
  technicalContext: Record<string, unknown> | null;
  canManage: boolean;
};

type SupportResponse = {
  currentUser: {
    id: string;
    name: string;
    role: string;
    canManage: boolean;
  };
  stats: {
    open: number;
    inProgress: number;
    resolved: number;
    closed: number;
  };
  tickets: TicketListItem[];
};

const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Aberto",
  IN_PROGRESS: "Em atendimento",
  RESOLVED: "Resolvido",
  CLOSED: "Fechado",
};

const statusColors: Record<TicketStatus, string> = {
  OPEN: "blue",
  IN_PROGRESS: "orange",
  RESOLVED: "green",
  CLOSED: "gray",
};

const priorityLabels: Record<TicketPriority, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const priorityColors: Record<TicketPriority, string> = {
  LOW: "gray",
  MEDIUM: "blue",
  HIGH: "orange",
  CRITICAL: "red",
};

const moduleOptions = [
  "Dashboard",
  "Clientes",
  "Extratos",
  "Faturas",
  "Adquirentes",
  "Motor Cambial",
  "Onboarding",
  "Relatórios",
  "Histórico",
  "Conta Azul",
  "Outro",
];

const categoryOptions = [
  "Erro",
  "Dúvida",
  "Solicitação",
  "Sugestão",
  "Nova funcionalidade",
  "Acesso",
  "Financeiro",
  "Outro",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function fileMetadata(files: File[]): Attachment[] {
  return files.map((file) => ({
    name: file.name,
    size: file.size,
    type: file.type,
  }));
}

export default function SuportePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageFileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<string | null>("tickets");
  const [data, setData] = useState<SupportResponse | null>(null);
  const [selected, setSelected] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>("ALL");

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<string | null>("MEDIUM");
  const [category, setCategory] = useState<string | null>(null);
  const [module, setModule] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);

  const [message, setMessage] = useState("");
  const [messageAttachments, setMessageAttachments] = useState<File[]>([]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter && statusFilter !== "ALL") {
        params.set("status", statusFilter);
      }

      const response = await fetch(`/api/support?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as SupportResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar os chamados.");
      }

      setData(payload);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os chamados.",
      );
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadTickets();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [loadTickets]);

  async function openTicket(id: string) {
    setDetailLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/support/${id}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as TicketDetail & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível abrir o chamado.");
      }

      setSelected(payload);
      setTab("conversation");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir o chamado.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  async function createTicket() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          description,
          priority,
          category,
          module,
          attachments: fileMetadata(attachments),
        }),
      });

      const payload = (await response.json()) as {
        id?: string;
        error?: string;
        message?: string;
      };

      if (!response.ok || !payload.id) {
        throw new Error(payload.error || "Não foi possível criar o chamado.");
      }

      setSubject("");
      setDescription("");
      setPriority("MEDIUM");
      setCategory(null);
      setModule(null);
      setAttachments([]);
      setSuccess(payload.message || "Chamado criado com sucesso.");
      await loadTickets();
      await openTicket(payload.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível criar o chamado.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage() {
    if (!selected || !message.trim()) return;

    setSending(true);
    setError("");

    try {
      const response = await fetch(`/api/support/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: message,
          attachments: fileMetadata(messageAttachments),
        }),
      });

      const payload = (await response.json()) as {
        message?: TicketMessage;
        error?: string;
      };

      if (!response.ok || !payload.message) {
        throw new Error(payload.error || "Não foi possível enviar a mensagem.");
      }

      setSelected((current) =>
        current
          ? {
              ...current,
              messages: [...current.messages, payload.message!],
              updatedAt: payload.message!.createdAt,
            }
          : current,
      );
      setMessage("");
      setMessageAttachments([]);
      await loadTickets();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar a mensagem.",
      );
    } finally {
      setSending(false);
    }
  }

  async function updateTicket(
    updates: Partial<Pick<TicketDetail, "status" | "priority">>,
  ) {
    if (!selected) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/support/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      const payload = (await response.json()) as {
        status?: TicketStatus;
        priority?: TicketPriority;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível atualizar o chamado.");
      }

      setSelected((current) =>
        current
          ? {
              ...current,
              status: payload.status ?? current.status,
              priority: payload.priority ?? current.priority,
            }
          : current,
      );
      await loadTickets();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar o chamado.",
      );
    } finally {
      setSaving(false);
    }
  }

  const activeCount = useMemo(
    () => (data ? data.stats.open + data.stats.inProgress : 0),
    [data],
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={0.8}>
            Fortuno Hub
          </Text>
          <Title order={2}>Suporte</Title>
          <Text size="sm" c="dimmed">
            Registre problemas, acompanhe o atendimento e mantenha todo o histórico.
          </Text>
        </Stack>

        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setTab("new")}
        >
          Novo chamado
        </Button>
      </Group>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert color="green" withCloseButton onClose={() => setSuccess("")}>
          {success}
        </Alert>
      )}

      <Paper withBorder radius="lg" p={0} style={{ overflow: "hidden" }}>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing={0}>
          <Metric label="Em aberto" value={activeCount} />
          <Metric label="Novos" value={data?.stats.open ?? 0} bordered />
          <Metric
            label="Em atendimento"
            value={data?.stats.inProgress ?? 0}
            bordered
          />
          <Metric
            label="Resolvidos"
            value={(data?.stats.resolved ?? 0) + (data?.stats.closed ?? 0)}
            bordered
          />
        </SimpleGrid>
      </Paper>

      <Tabs value={tab} onChange={setTab}>
        <Tabs.List>
          <Tabs.Tab value="tickets" leftSection={<IconTicket size={16} />}>
            Chamados
          </Tabs.Tab>
          <Tabs.Tab value="new" leftSection={<IconPlus size={16} />}>
            Novo chamado
          </Tabs.Tab>
          {selected && (
            <Tabs.Tab
              value="conversation"
              leftSection={<IconMessageCircle size={16} />}
            >
              {selected.code}
            </Tabs.Tab>
          )}
        </Tabs.List>

        <Tabs.Panel value="tickets" pt="lg">
          <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
            <Group justify="space-between" p="lg">
              <Stack gap={1}>
                <Title order={4}>Chamados registrados</Title>
                <Text size="sm" c="dimmed">
                  Dados reais salvos no banco da organização.
                </Text>
              </Stack>

              <Group>
                <TextInput
                  placeholder="Buscar título ou descrição"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  leftSection={<IconSearch size={16} />}
                  w={260}
                />
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  data={[
                    { value: "ALL", label: "Todos os status" },
                    { value: "OPEN", label: "Abertos" },
                    { value: "IN_PROGRESS", label: "Em atendimento" },
                    { value: "RESOLVED", label: "Resolvidos" },
                    { value: "CLOSED", label: "Fechados" },
                  ]}
                  w={190}
                />
                <ActionIcon
                  variant="default"
                  size="lg"
                  onClick={() => void loadTickets()}
                  loading={loading}
                  aria-label="Atualizar"
                >
                  <IconRefresh size={17} />
                </ActionIcon>
              </Group>
            </Group>

            {loading && !data ? (
              <Center py={80}>
                <Loader />
              </Center>
            ) : data?.tickets.length ? (
              <ScrollArea>
                <Table miw={920} verticalSpacing="sm" horizontalSpacing="lg">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Chamado</Table.Th>
                      <Table.Th>Solicitante</Table.Th>
                      <Table.Th>Módulo</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Prioridade</Table.Th>
                      <Table.Th>Atualização</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.tickets.map((ticket) => (
                      <Table.Tr key={ticket.id}>
                        <Table.Td>
                          <Text size="xs" c="dimmed" fw={700}>
                            {ticket.code}
                          </Text>
                          <Text fw={600} size="sm">
                            {ticket.subject}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {ticket.messageCount} mensagem(ns)
                          </Text>
                        </Table.Td>
                        <Table.Td>{ticket.requester.name}</Table.Td>
                        <Table.Td>
                          <Text size="sm">{ticket.module}</Text>
                          <Text size="xs" c="dimmed">
                            {ticket.category}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={statusColors[ticket.status]}
                            variant="light"
                          >
                            {statusLabels[ticket.status]}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={priorityColors[ticket.priority]}
                            variant="outline"
                          >
                            {priorityLabels[ticket.priority]}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{formatDate(ticket.updatedAt)}</Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="subtle"
                            rightSection={<IconArrowRight size={14} />}
                            onClick={() => void openTicket(ticket.id)}
                            loading={detailLoading}
                          >
                            Abrir
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            ) : (
              <Center py={80}>
                <Stack align="center" gap="xs">
                  <IconTicket size={34} opacity={0.35} />
                  <Text fw={600}>Nenhum chamado encontrado</Text>
                  <Text size="sm" c="dimmed">
                    Abra um chamado para iniciar um atendimento.
                  </Text>
                </Stack>
              </Center>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="new" pt="lg">
          <Paper withBorder radius="lg" p={{ base: "lg", md: "xl" }}>
            <Stack gap="lg" maw={920}>
              <Stack gap={2}>
                <Title order={4}>Abrir novo chamado</Title>
                <Text size="sm" c="dimmed">
                  Informe o que aconteceu, o resultado esperado e o módulo envolvido.
                </Text>
              </Stack>

              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <TextInput
                  label="Título"
                  placeholder="Ex.: Erro ao importar fatura do Inter"
                  value={subject}
                  onChange={(event) => setSubject(event.currentTarget.value)}
                  required
                />
                <Select
                  label="Módulo"
                  placeholder="Selecione"
                  data={moduleOptions}
                  value={module}
                  onChange={setModule}
                  searchable
                  required
                />
                <Select
                  label="Categoria"
                  placeholder="Selecione"
                  data={categoryOptions}
                  value={category}
                  onChange={setCategory}
                  required
                />
                <Select
                  label="Prioridade"
                  value={priority}
                  onChange={setPriority}
                  data={[
                    { value: "LOW", label: "Baixa" },
                    { value: "MEDIUM", label: "Média" },
                    { value: "HIGH", label: "Alta" },
                    { value: "CRITICAL", label: "Crítica" },
                  ]}
                />
              </SimpleGrid>

              <Textarea
                label="Descrição"
                description="Inclua os passos executados, mensagem de erro e resultado esperado."
                minRows={7}
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                required
              />

              <Paper
                withBorder
                radius="md"
                p="md"
                style={{ borderStyle: "dashed" }}
              >
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Stack gap={1}>
                      <Text fw={600}>Evidências</Text>
                      <Text size="xs" c="dimmed">
                        Registre PDFs, imagens, planilhas, logs ou ZIPs relacionados.
                      </Text>
                    </Stack>

                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        setAttachments((current) => [...current, ...files]);
                        event.currentTarget.value = "";
                      }}
                    />

                    <Button
                      variant="default"
                      leftSection={<IconPaperclip size={16} />}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Selecionar arquivos
                    </Button>
                  </Group>

                  {attachments.map((file, index) => (
                    <Group key={`${file.name}-${index}`} justify="space-between">
                      <Group gap="sm">
                        <IconFile size={17} />
                        <Stack gap={0}>
                          <Text size="sm" fw={600}>
                            {file.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </Text>
                        </Stack>
                      </Group>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  ))}
                </Stack>
              </Paper>

              <Alert color="blue">
                O chamado e a conversa serão salvos no banco. Nesta versão, os
                nomes, tipos e tamanhos dos anexos ficam registrados no chamado;
                o armazenamento físico dos arquivos depende da configuração de
                um bucket de arquivos.
              </Alert>

              <Group justify="flex-end">
                <Button
                  onClick={() => void createTicket()}
                  loading={saving}
                  disabled={
                    subject.trim().length < 4 ||
                    description.trim().length < 10 ||
                    !category ||
                    !module
                  }
                >
                  Criar chamado
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="conversation" pt="lg">
          {selected && (
            <SimpleGrid cols={{ base: 1, xl: 3 }}>
              <Paper withBorder radius="lg" p="lg">
                <Stack gap="lg">
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed" fw={700}>
                      {selected.code}
                    </Text>
                    <Title order={4}>{selected.subject}</Title>
                    <Text size="sm" c="dimmed">
                      Aberto por {selected.requester.name}
                    </Text>
                  </Stack>

                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">Módulo</Text>
                      <Text size="sm" fw={600}>{selected.module}</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">Categoria</Text>
                      <Text size="sm" fw={600}>{selected.category}</Text>
                    </Group>
                    <Group justify="space-between">
                      <Text size="sm" c="dimmed">Criado em</Text>
                      <Text size="sm">{formatDate(selected.createdAt)}</Text>
                    </Group>
                  </Stack>

                  {selected.canManage ? (
                    <Stack gap="sm">
                      <Select
                        label="Status"
                        value={selected.status}
                        onChange={(value) => {
                          if (value) {
                            void updateTicket({
                              status: value as TicketStatus,
                            });
                          }
                        }}
                        data={[
                          { value: "OPEN", label: "Aberto" },
                          { value: "IN_PROGRESS", label: "Em atendimento" },
                          { value: "RESOLVED", label: "Resolvido" },
                          { value: "CLOSED", label: "Fechado" },
                        ]}
                        disabled={saving}
                      />
                      <Select
                        label="Prioridade"
                        value={selected.priority}
                        onChange={(value) => {
                          if (value) {
                            void updateTicket({
                              priority: value as TicketPriority,
                            });
                          }
                        }}
                        data={[
                          { value: "LOW", label: "Baixa" },
                          { value: "MEDIUM", label: "Média" },
                          { value: "HIGH", label: "Alta" },
                          { value: "CRITICAL", label: "Crítica" },
                        ]}
                        disabled={saving}
                      />
                    </Stack>
                  ) : (
                    <Group>
                      <Badge
                        color={statusColors[selected.status]}
                        variant="light"
                      >
                        {statusLabels[selected.status]}
                      </Badge>
                      <Badge
                        color={priorityColors[selected.priority]}
                        variant="outline"
                      >
                        {priorityLabels[selected.priority]}
                      </Badge>
                    </Group>
                  )}
                </Stack>
              </Paper>

              <Paper
                withBorder
                radius="lg"
                p="lg"
                style={{ gridColumn: "span 2" }}
              >
                <Stack gap="md">
                  <Group justify="space-between">
                    <Stack gap={1}>
                      <Title order={4}>Conversa</Title>
                      <Text size="sm" c="dimmed">
                        Histórico completo do atendimento.
                      </Text>
                    </Stack>
                    <Badge
                      color={statusColors[selected.status]}
                      variant="light"
                    >
                      {statusLabels[selected.status]}
                    </Badge>
                  </Group>

                  <ScrollArea h={430}>
                    <Stack gap="md" pr="sm">
                      {selected.messages.map((item) => {
                        const ownMessage =
                          item.userId === data?.currentUser.id;

                        return (
                          <Group
                            key={item.id}
                            justify={ownMessage ? "flex-end" : "flex-start"}
                            align="flex-start"
                          >
                            {!ownMessage && (
                              <Avatar color={item.senderType === "SUPPORT" ? "blue" : "gray"}>
                                {item.userName.slice(0, 1).toUpperCase()}
                              </Avatar>
                            )}

                            <Paper
                              withBorder
                              radius="lg"
                              p="md"
                              maw="78%"
                              bg={
                                ownMessage
                                  ? "var(--mantine-color-blue-light)"
                                  : undefined
                              }
                            >
                              <Stack gap="xs">
                                <Text size="xs" fw={700} c="dimmed">
                                  {item.userName}
                                  {item.senderType === "SUPPORT" ? " · Suporte" : ""}
                                </Text>
                                <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                  {item.text}
                                </Text>
                                {!!item.attachments?.length && (
                                  <Stack gap={4}>
                                    {item.attachments.map((attachment) => (
                                      <Badge
                                        key={attachment.name}
                                        variant="outline"
                                        color="gray"
                                        leftSection={<IconPaperclip size={11} />}
                                      >
                                        {attachment.name}
                                      </Badge>
                                    ))}
                                  </Stack>
                                )}
                                <Text size="xs" c="dimmed" ta="right">
                                  {formatDate(item.createdAt)}
                                </Text>
                              </Stack>
                            </Paper>

                            {ownMessage && (
                              <Avatar>
                                {item.userName.slice(0, 1).toUpperCase()}
                              </Avatar>
                            )}
                          </Group>
                        );
                      })}
                    </Stack>
                  </ScrollArea>

                  <Textarea
                    placeholder="Digite sua mensagem..."
                    minRows={3}
                    value={message}
                    onChange={(event) => setMessage(event.currentTarget.value)}
                  />

                  {!!messageAttachments.length && (
                    <Group gap="xs">
                      {messageAttachments.map((file) => (
                        <Badge key={file.name} variant="outline" color="gray">
                          {file.name}
                        </Badge>
                      ))}
                    </Group>
                  )}

                  <Group justify="space-between">
                    <input
                      ref={messageFileInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(event) => {
                        setMessageAttachments(
                          Array.from(event.currentTarget.files ?? []),
                        );
                        event.currentTarget.value = "";
                      }}
                    />
                    <Button
                      variant="default"
                      leftSection={<IconPaperclip size={16} />}
                      onClick={() => messageFileInputRef.current?.click()}
                    >
                      Anexar
                    </Button>
                    <Button
                      rightSection={<IconSend size={16} />}
                      onClick={() => void sendMessage()}
                      loading={sending}
                      disabled={!message.trim()}
                    >
                      Enviar mensagem
                    </Button>
                  </Group>
                </Stack>
              </Paper>
            </SimpleGrid>
          )}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function Metric({
  label,
  value,
  bordered = false,
}: {
  label: string;
  value: number;
  bordered?: boolean;
}) {
  return (
    <Stack
      gap={3}
      p="lg"
      style={{
        borderLeft: bordered
          ? "1px solid var(--mantine-color-gray-2)"
          : undefined,
      }}
    >
      <Text size="xs" c="dimmed" fw={600}>
        {label.toUpperCase()}
      </Text>
      <Text fw={750} fz={26}>{value}</Text>
    </Stack>
  );
}
