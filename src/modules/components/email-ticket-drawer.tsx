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
  IconMessageReply,
  IconPaperclip,
  IconSend,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
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
  const [reply, setReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replySuccess, setReplySuccess] = useState("");

  useEffect(() => {
    setReply("");
    setReplyError("");
    setReplySuccess("");
  }, [ticket?.id]);

  const canReply = useMemo(
    () =>
      Boolean(
        ticket?.source === "GMAIL" &&
          ticket?.externalThreadId &&
          messages.some(
            (message: Any) =>
              message.direction === "INBOUND" &&
              message.externalMessageId,
          ),
      ),
    [ticket, messages],
  );

  async function sendReply() {
    if (!ticket?.id || !reply.trim() || !canReply) return;

    setSendingReply(true);
    setReplyError("");
    setReplySuccess("");

    try {
      const response = await fetch(
        `/api/atendimento/${ticket.id}/reply`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: reply.trim(),
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Não foi possível enviar a resposta.",
        );
      }

      setReply("");
      setReplySuccess("Resposta enviada pelo Gmail.");

      // Recarrega o ticket via ação neutra já existente:
      // o backend de reply retorna o ticket atualizado no próximo pacote;
      // por enquanto forçamos uma atualização visual do status.
      await updateTicket("status", {
        status: "WAITING_CUSTOMER",
      });
    } catch (error) {
      setReplyError(
        error instanceof Error
          ? error.message
          : "Não foi possível enviar a resposta.",
      );
    } finally {
      setSendingReply(false);
    }
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="92%"
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
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size={34} radius="xl" variant="light">
                <IconMail size={17} />
              </ThemeIcon>
              <div className={styles.topbarIdentity}>
                <Text size="xs" c="dimmed" fw={700} tt="uppercase">
                  E-mail · atendimento
                </Text>
                <Text fw={700} size="sm" lineClamp={1}>
                  {ticket.client?.name || ticket.senderEmail}
                </Text>
              </div>
            </Group>

            <Group gap="xs">
              <Badge
                size="md"
                variant="light"
                color={statusColors[ticket.status] || "gray"}
              >
                {statusLabels[ticket.status] || ticket.status}
              </Badge>
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                leftSection={<IconX size={15} />}
                onClick={onClose}
              >
                Fechar
              </Button>
            </Group>
          </header>

          <div className={styles.emailContentGrid}>
            <main className={styles.emailMain}>
              <ScrollArea h="calc(100vh - 58px)">
                <div className={styles.emailMainInner}>
                  <div className={styles.subjectBlock}>
                    <Title order={2} className={styles.emailSubject}>
                      {ticket.subject}
                    </Title>
                    <Text size="xs" c="dimmed" mt={4}>
                      {messages.length}{" "}
                      {messages.length === 1 ? "mensagem" : "mensagens"} · recebido em{" "}
                      {formatDate(ticket.receivedAt)}
                    </Text>
                  </div>

                  <Stack gap="md">
                    {messages.map((message: Any, index: number) => {
                      const internal = message.direction === "INTERNAL";
                      const outbound = message.direction === "OUTBOUND";
                      const attachments = message.attachments || [];

                      return (
                        <Paper
                          key={message.id}
                          withBorder={!internal}
                          radius="md"
                          className={
                            internal
                              ? styles.internalMessage
                              : outbound
                                ? styles.outboundMessage
                                : styles.emailMessage
                          }
                        >
                          <div className={styles.messageHeader}>
                            <Group gap="sm" wrap="nowrap">
                              <Avatar
                                radius="xl"
                                size={34}
                                color={
                                  internal
                                    ? "yellow"
                                    : outbound
                                      ? "green"
                                      : "blue"
                                }
                              >
                                {(internal
                                  ? "F"
                                  : message.fromName ||
                                    message.fromEmail ||
                                    "?")
                                  .slice(0, 1)
                                  .toUpperCase()}
                              </Avatar>

                              <div className={styles.messageIdentity}>
                                <Group gap={6} wrap="nowrap">
                                  <Text fw={700} size="sm" lineClamp={1}>
                                    {internal
                                      ? "Observação interna"
                                      : outbound
                                        ? "Fortuno"
                                        : message.fromName || message.fromEmail}
                                  </Text>

                                  {index === 0 && !internal && (
                                    <Badge size="xs" variant="light">
                                      Inicial
                                    </Badge>
                                  )}

                                  {outbound && (
                                    <Badge size="xs" color="green" variant="light">
                                      Enviada
                                    </Badge>
                                  )}
                                </Group>

                                {!internal && (
                                  <Text size="xs" c="dimmed" lineClamp={1}>
                                    {message.fromEmail} →{" "}
                                    {(message.toEmails || []).join(", ") ||
                                      ticket.recipientEmail ||
                                      "caixa conectada"}
                                  </Text>
                                )}
                              </div>
                            </Group>

                            <Text
                              size="xs"
                              c="dimmed"
                              style={{ whiteSpace: "nowrap" }}
                            >
                              {formatDate(message.receivedAt)}
                            </Text>
                          </div>

                          <div className={styles.messageBody}>
                            {internal ? (
                              <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                {message.textBody || "Observação sem conteúdo."}
                              </Text>
                            ) : message.htmlBody && !outbound ? (
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
                            <div className={styles.attachments}>
                              <Group gap="xs">
                                {attachments.map((file: Any) => (
                                  <Paper
                                    key={file.id}
                                    withBorder
                                    radius="md"
                                    px="sm"
                                    py={7}
                                    className={styles.attachmentChip}
                                  >
                                    <Group gap={6} wrap="nowrap">
                                      <IconPaperclip size={14} />
                                      <Text size="xs" fw={600} lineClamp={1}>
                                        {file.name}
                                      </Text>
                                    </Group>
                                  </Paper>
                                ))}
                              </Group>
                            </div>
                          )}
                        </Paper>
                      );
                    })}
                  </Stack>

                  <Paper
                    withBorder
                    radius="md"
                    className={styles.replyComposer}
                    mt="md"
                  >
                    <Group gap="xs" mb={8}>
                      <IconMessageReply size={17} />
                      <Text fw={700} size="sm">
                        Responder
                      </Text>
                      <Text size="xs" c="dimmed">
                        como {bootstrap?.currentUser?.name || "Fortuno"}
                      </Text>
                    </Group>

                    <Textarea
                      variant="unstyled"
                      minRows={4}
                      autosize
                      maxRows={10}
                      placeholder={
                        canReply
                          ? `Responder para ${ticket.senderEmail}...`
                          : "A resposta só fica disponível para chamados recebidos pelo Gmail."
                      }
                      value={reply}
                      disabled={!canReply}
                      onChange={(event) =>
                        setReply(event.currentTarget.value)
                      }
                      classNames={{
                        input: styles.replyInput,
                      }}
                    />

                    {replyError && (
                      <Text size="xs" c="red">
                        {replyError}
                      </Text>
                    )}

                    {replySuccess && (
                      <Text size="xs" c="green">
                        {replySuccess}
                      </Text>
                    )}

                    <Group justify="space-between" mt="sm">
                      <Text size="xs" c="dimmed">
                        A resposta será enviada pela conta Gmail conectada.
                      </Text>

                      <Button
                        size="sm"
                        leftSection={<IconSend size={15} />}
                        disabled={!canReply || !reply.trim()}
                        loading={sendingReply}
                        onClick={() => void sendReply()}
                      >
                        Enviar resposta
                      </Button>
                    </Group>
                  </Paper>

                  <Paper
                    radius="md"
                    className={styles.internalNoteBox}
                    mt="sm"
                  >
                    <Group gap="xs" mb={8}>
                      <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                        Nota interna
                      </Text>
                      <Text size="xs" c="dimmed">
                        · não é enviada ao cliente
                      </Text>
                    </Group>

                    <Textarea
                      variant="unstyled"
                      minRows={2}
                      autosize
                      maxRows={6}
                      placeholder="Adicionar observação para a equipe..."
                      value={note}
                      onChange={(event) =>
                        setNote(event.currentTarget.value)
                      }
                    />

                    <Group justify="flex-end" mt={6}>
                      <Button
                        variant="subtle"
                        size="compact-sm"
                        disabled={!note.trim()}
                        loading={saving}
                        onClick={async () => {
                          const ok = await updateTicket("note", {
                            content: note,
                          });
                          if (ok) setNote("");
                        }}
                      >
                        Salvar nota
                      </Button>
                    </Group>
                  </Paper>
                </div>
              </ScrollArea>
            </main>

            <aside className={styles.ticketPanel}>
              <ScrollArea h="calc(100vh - 58px)">
                <Stack p="md" gap="md">
                  <div>
                    <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                      Atendimento
                    </Text>
                    <Text fw={700} mt={2}>
                      Dados do chamado
                    </Text>
                  </div>

                  <Stack gap="sm">
                    <Select
                      label="Cliente"
                      size="sm"
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
                      size="sm"
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
                      size="sm"
                      data={[
                        { value: "LOW", label: "Baixa" },
                        { value: "MEDIUM", label: "Média" },
                        { value: "HIGH", label: "Alta" },
                        { value: "CRITICAL", label: "Crítica" },
                      ]}
                      value={ticket.priority}
                      onChange={(value) =>
                        value &&
                        void updateTicket("priority", { priority: value })
                      }
                    />
                  </Stack>

                  {!ticket.assignedTo && (
                    <Button
                      variant="light"
                      size="sm"
                      leftSection={<IconUser size={15} />}
                      loading={saving}
                      onClick={() =>
                        void updateTicket("assign", {
                          assignedToId: bootstrap.currentUser.id,
                        })
                      }
                    >
                      Assumir
                    </Button>
                  )}

                  <Divider />

                  <Stack gap={7}>
                    <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                      Status
                    </Text>

                    {ticket.status !== "IN_PROGRESS" &&
                      ticket.status !== "RESOLVED" &&
                      ticket.status !== "SPAM" && (
                        <Button
                          variant="light"
                          size="sm"
                          onClick={() =>
                            void updateTicket("status", {
                              status: "IN_PROGRESS",
                            })
                          }
                        >
                          Em atendimento
                        </Button>
                      )}

                    <Button
                      variant="light"
                      color="yellow"
                      size="sm"
                      onClick={() =>
                        void updateTicket("status", {
                          status: "WAITING_CUSTOMER",
                        })
                      }
                    >
                      Aguardando cliente
                    </Button>

                    <Button
                      variant="light"
                      color="orange"
                      size="sm"
                      onClick={() =>
                        void updateTicket("status", {
                          status: "WAITING_INTERNAL",
                        })
                      }
                    >
                      Aguardando interno
                    </Button>

                    {ticket.status !== "RESOLVED" ? (
                      <Button
                        color="green"
                        variant="light"
                        size="sm"
                        leftSection={<IconCircleCheck size={15} />}
                        onClick={() =>
                          void updateTicket("status", {
                            status: "RESOLVED",
                          })
                        }
                      >
                        Resolver
                      </Button>
                    ) : (
                      <Button
                        variant="light"
                        size="sm"
                        leftSection={<IconArrowBackUp size={15} />}
                        onClick={() =>
                          void updateTicket("status", {
                            status: "IN_PROGRESS",
                          })
                        }
                      >
                        Reabrir
                      </Button>
                    )}

                    {ticket.status !== "SPAM" ? (
                      <Button
                        color="gray"
                        variant="subtle"
                        size="sm"
                        leftSection={<IconAlertTriangle size={15} />}
                        onClick={() =>
                          void updateTicket("status", {
                            status: "SPAM",
                          })
                        }
                      >
                        Marcar como spam
                      </Button>
                    ) : (
                      <Button
                        variant="light"
                        size="sm"
                        onClick={() =>
                          void updateTicket("status", {
                            status: "NEW",
                          })
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
                        <Text
                          size="xs"
                          fw={800}
                          c="dimmed"
                          tt="uppercase"
                          mb="xs"
                        >
                          Histórico
                        </Text>

                        <Stack gap="sm">
                          {ticket.history
                            .slice(0, 6)
                            .map((item: Any) => (
                              <Group
                                key={item.id}
                                gap="xs"
                                align="flex-start"
                                wrap="nowrap"
                              >
                                <ThemeIcon
                                  size={24}
                                  radius="xl"
                                  variant="light"
                                >
                                  <IconClock size={12} />
                                </ThemeIcon>
                                <div>
                                  <Text size="xs" fw={600}>
                                    {item.message}
                                  </Text>
                                  <Text size="xs" c="dimmed">
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
