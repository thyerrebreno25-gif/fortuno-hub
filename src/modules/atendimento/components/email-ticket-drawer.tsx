"use client";

import {
  Avatar,
  Badge,
  Button,
  Divider,
  Drawer,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCircleCheck,
  IconClock,
  IconMail,
  IconPaperclip,
  IconSend,
  IconUser,
} from "@tabler/icons-react";
import styles from "@/app/(platform)/atendimento/atendimento.module.css";

type Any = Record<string, any>;

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

function formatDate(value?: string) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export function EmailTicketDrawer({
  opened,
  loading,
  ticket,
  bootstrap,
  saving,
  note,
  setNote,
  updateTicket,
  memberOptions,
  clientOptions,
  onClose,
}: {
  opened: boolean;
  loading: boolean;
  ticket: Any | null;
  bootstrap: Any;
  saving: boolean;
  note: string;
  setNote: (value: string) => void;
  updateTicket: (action: string, payload?: Any) => Promise<boolean>;
  memberOptions: Any[];
  clientOptions: Any[];
  onClose: () => void;
}) {
  const canManage = bootstrap?.currentUser?.canManage;
  const messages = ticket?.messages || [];

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="94%"
      padding={0}
      withCloseButton={false}
      classNames={{ body: styles.emailDrawerBody }}
    >
      {loading ? (
        <Group justify="center" py={120}>
          <Loader />
        </Group>
      ) : !ticket ? null : (
        <div className={styles.emailView}>
          <header className={styles.emailTopbar}>
            <Group gap="sm">
              <ThemeIcon size={40} radius="xl" variant="light">
                <IconMail size={20} />
              </ThemeIcon>
              <div>
                <Text size="xs" c="dimmed" fw={800} tt="uppercase">
                  Chamado por e-mail
                </Text>
                <Text fw={800}>{ticket.client?.name || ticket.senderEmail}</Text>
              </div>
            </Group>

            <Group gap="sm">
              <Badge
                size="lg"
                variant="light"
                color={statusColors[ticket.status] || "gray"}
              >
                {statusLabels[ticket.status] || ticket.status}
              </Badge>
              <Button variant="default" onClick={onClose}>
                Fechar
              </Button>
            </Group>
          </header>

          <div className={styles.emailContentGrid}>
            <main className={styles.emailMain}>
              <ScrollArea h="calc(100vh - 72px)">
                <div className={styles.emailMainInner}>
                  <Stack gap={5} mb="xl">
                    <Title order={2} className={styles.emailSubject}>
                      {ticket.subject}
                    </Title>
                    <Group gap="xs">
                      <Text size="sm" c="dimmed">
                        Recebido em {formatDate(ticket.receivedAt)}
                      </Text>
                      <Text size="sm" c="dimmed">·</Text>
                      <Text size="sm" c="dimmed">
                        {messages.length} {messages.length === 1 ? "mensagem" : "mensagens"}
                      </Text>
                    </Group>
                  </Stack>

                  <Stack gap="lg">
                    {messages.map((message: Any, index: number) => {
                      const internal = message.direction === "INTERNAL";
                      const attachments = message.attachments || [];

                      return (
                        <Paper
                          key={message.id}
                          withBorder
                          radius="lg"
                          className={internal ? styles.internalMessage : styles.emailMessage}
                        >
                          <div className={styles.messageHeader}>
                            <Group gap="sm" wrap="nowrap">
                              <Avatar radius="xl" size={42} color={internal ? "yellow" : "blue"}>
                                {(internal
                                  ? "F"
                                  : message.fromName || message.fromEmail || "?")
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </Avatar>
                              <div className={styles.messageIdentity}>
                                <Group gap={7}>
                                  <Text fw={800} size="sm">
                                    {internal
                                      ? "Observação interna"
                                      : message.fromName || message.fromEmail}
                                  </Text>
                                  {index === 0 && !internal && (
                                    <Badge size="xs" variant="light">
                                      Mensagem inicial
                                    </Badge>
                                  )}
                                </Group>
                                {!internal && (
                                  <Text size="xs" c="dimmed" lineClamp={1}>
                                    &lt;{message.fromEmail}&gt; para{" "}
                                    {(message.toEmails || []).join(", ") ||
                                      ticket.recipientEmail ||
                                      "caixa conectada"}
                                  </Text>
                                )}
                              </div>
                            </Group>
                            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                              {formatDate(message.receivedAt)}
                            </Text>
                          </div>

                          <Divider />

                          <div className={styles.messageBody}>
                            {internal ? (
                              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                {message.textBody || "Observação sem conteúdo."}
                              </Text>
                            ) : message.htmlBody ? (
                              <iframe
                                title={`Mensagem ${index + 1}`}
                                sandbox=""
                                srcDoc={message.htmlBody}
                                className={styles.emailIframe}
                              />
                            ) : (
                              <Text
                                size="sm"
                                className={styles.plainTextEmail}
                                style={{ whiteSpace: "pre-wrap" }}
                              >
                                {message.textBody ||
                                  "Mensagem sem conteúdo disponível em texto."}
                              </Text>
                            )}
                          </div>

                          {attachments.length > 0 && (
                            <>
                              <Divider />
                              <div className={styles.attachments}>
                                <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                                  Anexos
                                </Text>
                                <Group gap="xs" mt={8}>
                                  {attachments.map((file: Any) => (
                                    <Paper
                                      key={file.id}
                                      withBorder
                                      radius="md"
                                      px="sm"
                                      py={8}
                                      className={styles.attachmentChip}
                                    >
                                      <Group gap={7} wrap="nowrap">
                                        <IconPaperclip size={15} />
                                        <div>
                                          <Text size="xs" fw={700} lineClamp={1}>
                                            {file.name}
                                          </Text>
                                          {file.mimeType && (
                                            <Text size="xs" c="dimmed">
                                              {file.mimeType}
                                            </Text>
                                          )}
                                        </div>
                                      </Group>
                                    </Paper>
                                  ))}
                                </Group>
                              </div>
                            </>
                          )}
                        </Paper>
                      );
                    })}
                  </Stack>

                  <Paper withBorder radius="lg" p="md" mt="xl">
                    <Stack gap="sm">
                      <Textarea
                        label="Observação interna"
                        description="Visível somente para a equipe da Fortuno."
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
                </div>
              </ScrollArea>
            </main>

            <aside className={styles.ticketPanel}>
              <ScrollArea h="calc(100vh - 72px)">
                <Stack p="lg" gap="lg">
                  <div>
                    <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                      Atendimento
                    </Text>
                    <Title order={4} mt={3}>
                      Dados do chamado
                    </Title>
                  </div>

                  <Paper withBorder radius="lg" p="md">
                    <Stack gap="md">
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

                  <Stack gap="xs">
                    <Text size="xs" fw={800} c="dimmed" tt="uppercase" mb={4}>
                      Alterar status
                    </Text>
                    {ticket.status !== "IN_PROGRESS" &&
                      ticket.status !== "RESOLVED" &&
                      ticket.status !== "SPAM" && (
                        <Button
                          variant="light"
                          fullWidth
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
                      fullWidth
                      onClick={() =>
                        void updateTicket("status", { status: "WAITING_CUSTOMER" })
                      }
                    >
                      Aguardando cliente
                    </Button>
                    <Button
                      variant="light"
                      color="orange"
                      fullWidth
                      onClick={() =>
                        void updateTicket("status", { status: "WAITING_INTERNAL" })
                      }
                    >
                      Aguardando interno
                    </Button>
                    {ticket.status !== "RESOLVED" ? (
                      <Button
                        color="green"
                        fullWidth
                        leftSection={<IconCircleCheck size={16} />}
                        onClick={() =>
                          void updateTicket("status", { status: "RESOLVED" })
                        }
                      >
                        Resolver chamado
                      </Button>
                    ) : (
                      <Button
                        variant="light"
                        fullWidth
                        leftSection={<IconArrowBackUp size={16} />}
                        onClick={() =>
                          void updateTicket("status", { status: "IN_PROGRESS" })
                        }
                      >
                        Reabrir chamado
                      </Button>
                    )}
                    {ticket.status !== "SPAM" ? (
                      <Button
                        color="gray"
                        variant="outline"
                        fullWidth
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
                        fullWidth
                        onClick={() =>
                          void updateTicket("status", { status: "NEW" })
                        }
                      >
                        Não é spam
                      </Button>
                    )}
                  </Stack>

                  {ticket.history?.length > 0 && (
                    <>
                      <Divider />
                      <div>
                        <Text size="xs" fw={800} c="dimmed" tt="uppercase" mb="sm">
                          Histórico
                        </Text>
                        <Stack gap="md">
                          {ticket.history.slice(0, 8).map((item: Any) => (
                            <Group key={item.id} align="flex-start" wrap="nowrap">
                              <ThemeIcon size={28} radius="xl" variant="light">
                                <IconClock size={14} />
                              </ThemeIcon>
                              <div>
                                <Text size="xs" fw={700}>
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
                      </div>
                    </>
                  )}
                </Stack>
              </ScrollArea>
            </aside>
          </div>
        </div>
      )}
    </Drawer>
  );
}
