"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
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
import { notifications } from "@mantine/notifications";
import {
  IconArchive,
  IconBrain,
  IconBuildingBank,
  IconFileAnalytics,
  IconMessageCirclePlus,
  IconPaperclip,
  IconSend,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import styles from "./assistant.module.css";

type ClientOption = {
  id: string;
  name: string;
  document: string | null;
  contaAzulConnected: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  clientId: string | null;
  preview: string;
  updatedAt: string;
  client?: { name: string } | null;
};

type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  attachments?: Array<{ name?: string }> | null;
  createdAt: string;
};

type Conversation = {
  id: string;
  title: string;
  clientId: string | null;
  client?: { id: string; name: string } | null;
  messages: Message[];
};

type Bootstrap = {
  configured: boolean;
  currentUser: { name: string; role: string };
  clients: ClientOption[];
  conversations: ConversationSummary[];
};

const starterPrompts = [
  {
    icon: <IconBuildingBank size={18} />,
    title: "Visão do cliente",
    text: "Resuma a situação operacional e as últimas atividades deste cliente.",
  },
  {
    icon: <IconFileAnalytics size={18} />,
    title: "Auditoria preliminar",
    text: "Faça uma auditoria financeira preliminar deste cliente no mês atual. Consulte o Conta Azul e informe fontes, período, divergências e limitações.",
  },
  {
    icon: <IconSparkles size={18} />,
    title: "Ajuda no Fortuno",
    text: "Explique como funciona o envio de uma fatura categorizada para o Conta Azul.",
  },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function readPayload(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a solicitação.");
  return payload;
}

export default function AssistantPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const viewport = useRef<HTMLDivElement>(null);

  const loadConversation = useCallback(async (id: string) => {
    const payload = await readPayload(await fetch(`/api/assistant/conversations/${id}`, { cache: "no-store" }));
    setConversation(payload.conversation);
  }, []);

  const createConversation = useCallback(async (clientId?: string | null) => {
    const payload = await readPayload(await fetch("/api/assistant/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientId || null }),
    }));
    const created: ConversationSummary = {
      ...payload.conversation,
      preview: "Conversa sem mensagens",
      client: clientId
        ? { name: bootstrap?.clients.find((client) => client.id === clientId)?.name || "Cliente" }
        : null,
    };
    setConversations((current) => [created, ...current]);
    await loadConversation(created.id);
  }, [bootstrap?.clients, loadConversation]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await readPayload(await fetch("/api/assistant/bootstrap", { cache: "no-store" })) as Bootstrap;
        if (!active) return;
        setBootstrap(data);
        setConversations(data.conversations);
        if (data.conversations[0]) {
          await loadConversation(data.conversations[0].id);
        } else {
          const created = await readPayload(await fetch("/api/assistant/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }));
          if (!active) return;
          setConversations([{ ...created.conversation, preview: "Conversa sem mensagens", client: null }]);
          await loadConversation(created.conversation.id);
        }
      } catch (error) {
        notifications.show({ color: "red", title: "Assistente indisponível", message: error instanceof Error ? error.message : "Falha ao abrir o assistente." });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [loadConversation]);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages, sending]);

  const selectedClient = useMemo(
    () => bootstrap?.clients.find((client) => client.id === conversation?.clientId) || null,
    [bootstrap?.clients, conversation?.clientId],
  );

  async function changeClient(clientId: string | null) {
    if (!conversation || sending) return;
    try {
      await readPayload(await fetch(`/api/assistant/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      }));
      setConversation((current) => current ? { ...current, clientId } : current);
      setConversations((current) => current.map((item) => item.id === conversation.id
        ? { ...item, clientId, client: clientId ? { name: bootstrap?.clients.find((client) => client.id === clientId)?.name || "Cliente" } : null }
        : item));
    } catch (error) {
      notifications.show({ color: "red", title: "Cliente não alterado", message: error instanceof Error ? error.message : "Tente novamente." });
    }
  }

  async function archiveConversation() {
    if (!conversation || sending) return;
    try {
      await readPayload(await fetch(`/api/assistant/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true }),
      }));
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (remaining[0]) await loadConversation(remaining[0].id);
      else await createConversation(null);
    } catch (error) {
      notifications.show({ color: "red", title: "Conversa não arquivada", message: error instanceof Error ? error.message : "Tente novamente." });
    }
  }

  async function sendMessage(text = message) {
    if (!conversation || sending || (!text.trim() && files.length === 0)) return;
    const form = new FormData();
    form.append("message", text.trim());
    files.forEach((file) => form.append("files", file));
    setSending(true);
    try {
      const payload = await readPayload(await fetch(`/api/assistant/conversations/${conversation.id}/messages`, { method: "POST", body: form }));
      setConversation((current) => current ? {
        ...current,
        title: current.title === "Nova conversa" ? (text.trim() || files[0]?.name || current.title).slice(0, 58) : current.title,
        messages: [...current.messages, payload.userMessage, payload.assistantMessage],
      } : current);
      setConversations((current) => current.map((item) => item.id === conversation.id ? {
        ...item,
        title: item.title === "Nova conversa" ? (text.trim() || files[0]?.name || item.title).slice(0, 58) : item.title,
        preview: payload.assistantMessage.content,
        updatedAt: payload.assistantMessage.createdAt,
      } : item).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
      setMessage("");
      setFiles([]);
    } catch (error) {
      notifications.show({ color: "red", title: "Mensagem não enviada", message: error instanceof Error ? error.message : "Tente novamente." });
    } finally {
      setSending(false);
    }
  }

  if (loading) return <Group justify="center" py={100}><Loader /></Group>;

  return (
    <div className={styles.page}>
      <aside className={styles.history}>
        <Group justify="space-between" mb="md">
          <div>
            <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>Fortuno Hub</Text>
            <Title order={3}>Assistente</Title>
          </div>
          <Tooltip label="Nova conversa">
            <ActionIcon size="lg" variant="light" onClick={() => void createConversation(conversation?.clientId)} aria-label="Nova conversa">
              <IconMessageCirclePlus size={20} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <ScrollArea className={styles.historyScroll}>
          <Stack gap={6}>
            {conversations.map((item) => (
              <button key={item.id} type="button" className={`${styles.historyItem} ${conversation?.id === item.id ? styles.historyItemActive : ""}`} onClick={() => void loadConversation(item.id)}>
                <Text fw={700} size="sm" lineClamp={1}>{item.title}</Text>
                <Text size="xs" c="dimmed" lineClamp={1}>{item.client?.name || item.preview}</Text>
              </button>
            ))}
          </Stack>
        </ScrollArea>
      </aside>

      <section className={styles.chat}>
        <header className={styles.chatHeader}>
          <Group justify="space-between" align="flex-end" wrap="nowrap">
            <div className={styles.clientSelect}>
              <Text size="xs" fw={800} mb={6}>Cliente da conversa</Text>
              <Select
                searchable
                clearable
                placeholder="Perguntas gerais sobre a plataforma"
                value={conversation?.clientId || null}
                onChange={(value) => void changeClient(value)}
                data={(bootstrap?.clients || []).map((client) => ({
                  value: client.id,
                  label: `${client.name}${client.contaAzulConnected ? " • Conta Azul conectado" : ""}`,
                }))}
                disabled={sending}
              />
            </div>
            <Group gap="xs" wrap="nowrap">
              {selectedClient && <Badge color={selectedClient.contaAzulConnected ? "green" : "gray"}>{selectedClient.contaAzulConnected ? "Conta Azul conectado" : "Sem conexão"}</Badge>}
              <Tooltip label="Arquivar conversa">
                <ActionIcon variant="subtle" color="gray" onClick={() => void archiveConversation()} aria-label="Arquivar conversa"><IconArchive size={19} /></ActionIcon>
              </Tooltip>
            </Group>
          </Group>
        </header>

        {!bootstrap?.configured && (
          <Alert color="orange" title="Inteligência ainda não configurada" mx="lg" mt="md">
            Configure a chave da OpenAI no ambiente. Os leitores determinísticos e a criação automática de chamados continuam disponíveis.
          </Alert>
        )}

        <ScrollArea viewportRef={viewport} className={styles.messages}>
          {!conversation?.messages.length ? (
            <div className={styles.empty}>
              <ThemeIcon size={64} radius={20} variant="light"><IconBrain size={34} /></ThemeIcon>
              <Title order={2} mt="md">Como posso ajudar?</Title>
              <Text c="dimmed" ta="center" maw={620} mt={8}>
                Pergunte sobre o Fortuno, selecione um cliente para consultar o Conta Azul ou anexe arquivos para análise. As respostas respeitam seu perfil e sua carteira.
              </Text>
              <div className={styles.starters}>
                {starterPrompts.map((starter) => (
                  <button key={starter.title} type="button" className={styles.starter} onClick={() => void sendMessage(starter.text)}>
                    <ThemeIcon variant="light" size="md">{starter.icon}</ThemeIcon>
                    <span><strong>{starter.title}</strong><small>{starter.text}</small></span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Stack gap="lg" py="xl">
              {conversation.messages.map((item) => (
                <div key={item.id} className={`${styles.messageRow} ${item.role === "USER" ? styles.messageRowUser : ""}`}>
                  {item.role === "ASSISTANT" && <ThemeIcon size={34} radius="xl" variant="light"><IconBrain size={19} /></ThemeIcon>}
                  <Paper className={`${styles.bubble} ${item.role === "USER" ? styles.userBubble : styles.assistantBubble}`} radius="lg" p="md">
                    <Text className={styles.messageText}>{item.content}</Text>
                    {Array.isArray(item.attachments) && item.attachments.length > 0 && (
                      <Group gap={6} mt="sm">{item.attachments.map((attachment, index) => <Badge key={`${attachment.name}-${index}`} variant="light" leftSection={<IconPaperclip size={12} />}>{attachment.name || "Arquivo"}</Badge>)}</Group>
                    )}
                    <Text size="xs" c="dimmed" mt={8} ta="right">{formatTime(item.createdAt)}</Text>
                  </Paper>
                </div>
              ))}
              {sending && (
                <div className={styles.messageRow}>
                  <ThemeIcon size={34} radius="xl" variant="light"><IconBrain size={19} /></ThemeIcon>
                  <Paper className={styles.assistantBubble} radius="lg" p="md"><Group gap="sm"><Loader size="xs" /><Text size="sm">Consultando e analisando…</Text></Group></Paper>
                </div>
              )}
            </Stack>
          )}
        </ScrollArea>

        <footer className={styles.composerArea}>
          {files.length > 0 && (
            <Group gap={8} mb="xs">
              {files.map((file, index) => (
                <Badge key={`${file.name}-${index}`} variant="outline" rightSection={<ActionIcon size="xs" variant="transparent" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><IconX size={12} /></ActionIcon>}>{file.name}</Badge>
              ))}
              <ActionIcon variant="subtle" color="gray" onClick={() => setFiles([])} aria-label="Remover anexos"><IconTrash size={16} /></ActionIcon>
            </Group>
          )}
          <div className={styles.composer}>
            <FileButton multiple onChange={(selected) => setFiles((current) => [...current, ...selected].slice(0, 5))} accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.ofx,.xml">
              {(props) => <Tooltip label="Anexar até 5 arquivos"><ActionIcon {...props} size="lg" variant="subtle" aria-label="Anexar arquivos"><IconPaperclip size={21} /></ActionIcon></Tooltip>}
            </FileButton>
            <Textarea
              autosize
              minRows={1}
              maxRows={6}
              placeholder={selectedClient ? `Pergunte sobre ${selectedClient.name}…` : "Pergunte sobre o Fortuno Hub…"}
              value={message}
              onChange={(event) => setMessage(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={sending}
              className={styles.textarea}
            />
            <Button className={styles.sendButton} px="sm" disabled={sending || (!message.trim() && files.length === 0)} loading={sending} onClick={() => void sendMessage()} aria-label="Enviar mensagem"><IconSend size={19} /></Button>
          </div>
          <Text size="xs" c="dimmed" ta="center" mt={8}>O assistente pode cometer erros. Confirme valores e conclusões antes de executar ações financeiras.</Text>
        </footer>
      </section>
    </div>
  );
}
