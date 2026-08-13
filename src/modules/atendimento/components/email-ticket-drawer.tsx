"use client";

import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Divider,
  Drawer,
  FileButton,
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
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconBold,
  IconCircleCheck,
  IconClock,
  IconItalic,
  IconLink,
  IconList,
  IconMail,
  IconMessageReply,
  IconPaperclip,
  IconSend,
  IconTrash,
  IconUnderline,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

function htmlToText(value: string) {
  if (typeof window === "undefined") return value;

  const div = document.createElement("div");
  div.innerHTML = value;

  return (div.innerText || div.textContent || "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  const editorRef = useRef<HTMLDivElement | null>(null);

  const [replyHtml, setReplyHtml] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState("");
  const [replySuccess, setReplySuccess] = useState("");

  useEffect(() => {
    setReplyHtml("");
    setAttachments([]);
    setReplyError("");
    setReplySuccess("");

    if (editorRef.current) {
      editorRef.current.innerHTML = "";
    }
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

  const replyText = useMemo(
    () => htmlToText(replyHtml),
    [replyHtml],
  );

  function applyFormat(
    command:
      | "bold"
      | "italic"
      | "underline"
      | "insertUnorderedList",
    value?: string,
  ) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setReplyHtml(editorRef.current?.innerHTML || "");
  }

  function insertLink() {
    const url = window.prompt("Cole o link:");
    if (!url) return;

    editorRef.current?.focus();
    document.execCommand("createLink", false, url);
    setReplyHtml(editorRef.current?.innerHTML || "");
  }

  function removeAttachment(index: number) {
    setAttachments((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  async function sendReply() {
    if (
      !ticket?.id ||
      !replyText ||
      !canReply
    ) {
      return;
    }

    setSendingReply(true);
    setReplyError("");
    setReplySuccess("");

    try {
      const form = new FormData();

      form.set("text", replyText);
      form.set("html", replyHtml);
      form.set(
        "includeSignature",
        includeSignature ? "true" : "false",
      );

      for (const file of attachments) {
        form.append("attachments", file);
      }

      const response = await fetch(
        `/api/atendimento/${ticket.id}/reply`,
        {
          method: "POST",
          body: form,
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Não foi possível enviar a resposta.",
        );
      }

      setReplyHtml("");
      setAttachments([]);

      if (editorRef.current) {
        editorRef.current.innerHTML = "";
      }

      setReplySuccess(
        attachments.length
          ? "Resposta e anexos enviados pelo Gmail."
          : "Resposta enviada pelo Gmail.",
      );

      // Recarrega o chamado usando a API existente.
      // O status já é WAITING_CUSTOMER no endpoint de resposta.
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
                <Text
                  size="xs"
                  c="dimmed"
                  fw={700}
                  tt="uppercase"
                >
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
                    <Title
                      order={2}
                      className={styles.emailSubject}
                    >
                      {ticket.subject}
                    </Title>

                    <Text size="xs" c="dimmed" mt={4}>
                      {messages.length}{" "}
                      {messages.length === 1
                        ? "mensagem"
                        : "mensagens"}{" "}
                      · recebido em {formatDate(ticket.receivedAt)}
                    </Text>
                  </div>

                  <Stack gap="md">
                    {messages.map(
                      (message: Any, index: number) => {
                        const internal =
                          message.direction === "INTERNAL";
                        const outbound =
                          message.direction === "OUTBOUND";
                        const files =
                          message.attachments || [];

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
                                    <Text
                                      fw={700}
                                      size="sm"
                                      lineClamp={1}
                                    >
                                      {internal
                                        ? "Observação interna"
                                        : outbound
                                          ? message.fromName || "Fortuno"
                                          : message.fromName ||
                                            message.fromEmail}
                                    </Text>

                                    {index === 0 && !internal && (
                                      <Badge
                                        size="xs"
                                        variant="light"
                                      >
                                        Inicial
                                      </Badge>
                                    )}

                                    {outbound && (
                                      <Badge
                                        size="xs"
                                        color="green"
                                        variant="light"
                                      >
                                        Enviada
                                      </Badge>
                                    )}
                                  </Group>

                                  {!internal && (
                                    <Text
                                      size="xs"
                                      c="dimmed"
                                      lineClamp={1}
                                    >
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
                                <Text
                                  size="sm"
                                  style={{ whiteSpace: "pre-wrap" }}
                                >
                                  {message.textBody ||
                                    "Observação sem conteúdo."}
                                </Text>
                              ) : message.htmlBody && !outbound ? (
                                <iframe
                                  title={`Mensagem ${index + 1}`}
                                  sandbox=""
                                  srcDoc={message.htmlBody}
                                  className={styles.emailIframe}
                                />
                              ) : message.htmlBody && outbound ? (
                                <div
                                  className={styles.sentHtml}
                                  dangerouslySetInnerHTML={{
                                    __html: message.htmlBody,
                                  }}
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

                            {files.length > 0 && (
                              <div className={styles.attachments}>
                                <Group gap="xs">
                                  {files.map((file: Any) => (
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

                                        <Text
                                          size="xs"
                                          fw={600}
                                          lineClamp={1}
                                        >
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
                      },
                    )}
                  </Stack>

                  <Paper
                    withBorder
                    radius="md"
                    className={styles.replyComposer}
                    mt="md"
                  >
                    <Group
                      justify="space-between"
                      align="center"
                      mb={8}
                    >
                      <Group gap="xs">
                        <IconMessageReply size={17} />

                        <Text fw={700} size="sm">
                          Responder
                        </Text>

                        <Text size="xs" c="dimmed">
                          para {ticket.senderEmail}
                        </Text>
                      </Group>

                      <Text size="xs" c="dimmed">
                        via Gmail conectado
                      </Text>
                    </Group>

                    <div className={styles.replyToolbar}>
                      <Tooltip label="Negrito">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={() => applyFormat("bold")}
                        >
                          <IconBold size={16} />
                        </ActionIcon>
                      </Tooltip>

                      <Tooltip label="Itálico">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={() => applyFormat("italic")}
                        >
                          <IconItalic size={16} />
                        </ActionIcon>
                      </Tooltip>

                      <Tooltip label="Sublinhado">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={() => applyFormat("underline")}
                        >
                          <IconUnderline size={16} />
                        </ActionIcon>
                      </Tooltip>

                      <Tooltip label="Lista">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={() =>
                            applyFormat("insertUnorderedList")
                          }
                        >
                          <IconList size={16} />
                        </ActionIcon>
                      </Tooltip>

                      <Tooltip label="Inserir link">
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          onClick={insertLink}
                        >
                          <IconLink size={16} />
                        </ActionIcon>
                      </Tooltip>

                      <Divider orientation="vertical" />

                      <FileButton
                        multiple
                        onChange={(files) => {
                          const selected = files || [];

                          setAttachments((current) => [
                            ...current,
                            ...selected,
                          ]);
                        }}
                      >
                        {(props) => (
                          <Button
                            {...props}
                            variant="subtle"
                            color="gray"
                            size="compact-sm"
                            leftSection={
                              <IconPaperclip size={15} />
                            }
                          >
                            Anexar
                          </Button>
                        )}
                      </FileButton>
                    </div>

                    <div
                      ref={editorRef}
                      className={`${styles.richReplyEditor} ${
                        !canReply
                          ? styles.richReplyEditorDisabled
                          : ""
                      }`}
                      contentEditable={canReply}
                      suppressContentEditableWarning
                      data-placeholder={
                        canReply
                          ? "Escreva sua resposta..."
                          : "A resposta está disponível somente em chamados recebidos pelo Gmail."
                      }
                      onInput={(event) =>
                        setReplyHtml(
                          event.currentTarget.innerHTML,
                        )
                      }
                    />

                    {attachments.length > 0 && (
                      <Stack gap={5} mt="sm">
                        {attachments.map((file, index) => (
                          <Group
                            key={`${file.name}-${file.size}-${index}`}
                            justify="space-between"
                            className={styles.replyAttachment}
                          >
                            <Group gap="xs" wrap="nowrap">
                              <IconPaperclip size={14} />

                              <div>
                                <Text size="xs" fw={600}>
                                  {file.name}
                                </Text>

                                <Text size="xs" c="dimmed">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </Text>
                              </div>
                            </Group>

                            <ActionIcon
                              color="red"
                              variant="subtle"
                              onClick={() =>
                                removeAttachment(index)
                              }
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>
                        ))}
                      </Stack>
                    )}

                    <Group
                      justify="space-between"
                      align="flex-end"
                      mt="md"
                    >
                      <Stack gap={3}>
                        <Checkbox
                          size="xs"
                          checked={includeSignature}
                          onChange={(event) =>
                            setIncludeSignature(
                              event.currentTarget.checked,
                            )
                          }
                          label="Incluir assinatura Fortuno"
                        />

                        <Text size="xs" c="dimmed">
                          A resposta entra na mesma conversa do Gmail.
                        </Text>
                      </Stack>

                      <Button
                        size="sm"
                        leftSection={<IconSend size={15} />}
                        disabled={
                          !canReply ||
                          !replyText ||
                          sendingReply
                        }
                        loading={sendingReply}
                        onClick={() => void sendReply()}
                      >
                        Enviar
                      </Button>
                    </Group>

                    {replyError && (
                      <Text size="xs" c="red" mt="xs">
                        {replyError}
                      </Text>
                    )}

                    {replySuccess && (
                      <Text size="xs" c="green" mt="xs">
                        {replySuccess}
                      </Text>
                    )}
                  </Paper>

                  <Paper
                    radius="md"
                    className={styles.internalNoteBox}
                    mt="sm"
                  >
                    <Group gap="xs" mb={8}>
                      <Text
                        size="xs"
                        fw={800}
                        c="dimmed"
                        tt="uppercase"
                      >
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
                          const ok =
                            await updateTicket("note", {
                              content: note,
                            });

                          if (ok) {
                            setNote("");
                          }
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
                    <Text
                      size="xs"
                      fw={800}
                      c="dimmed"
                      tt="uppercase"
                    >
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
                        void updateTicket("client", {
                          clientId: value,
                        })
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
                        void updateTicket("assign", {
                          assignedToId: value,
                        })
                      }
                    />

                    <Select
                      label="Prioridade"
                      size="sm"
                      data={[
                        {
                          value: "LOW",
                          label: "Baixa",
                        },
                        {
                          value: "MEDIUM",
                          label: "Média",
                        },
                        {
                          value: "HIGH",
                          label: "Alta",
                        },
                        {
                          value: "CRITICAL",
                          label: "Crítica",
                        },
                      ]}
                      value={ticket.priority}
                      onChange={(value) =>
                        value &&
                        void updateTicket("priority", {
                          priority: value,
                        })
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
                          assignedToId:
                            bootstrap.currentUser.id,
                        })
                      }
                    >
                      Assumir
                    </Button>
                  )}

                  <Divider />

                  <Stack gap={7}>
                    <Text
                      size="xs"
                      fw={800}
                      c="dimmed"
                      tt="uppercase"
                    >
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
                        leftSection={
                          <IconCircleCheck size={15} />
                        }
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
                        leftSection={
                          <IconArrowBackUp size={15} />
                        }
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
                        leftSection={
                          <IconAlertTriangle size={15} />
                        }
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
