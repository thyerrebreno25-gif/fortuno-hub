/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBell,
  IconBellPlus,
  IconCalendarDue,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconEye,
  IconNotes,
  IconRefresh,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react";
import styles from "./avisos.module.css";

type Notice = {
  id: string;
  kind: "ALERT" | "REMINDER" | "NOTE";
  scope: "PERSONAL" | "MEMBERS" | "CLIENTS" | "GENERAL";
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  title: string;
  body: string | null;
  targetsAllClients: boolean;
  dueAt: string | null;
  expiresAt: string | null;
  closedAt: string | null;
  createdAt: string;
  author: { id: string; name: string; email: string };
  clients: Array<{ id: string; name: string }>;
  mine: { viewedAt: string | null; completedAt: string | null } | null;
  audience: {
    total: number;
    viewed: number;
    pendingView: number;
    completed: number;
    pendingCompletion: number;
    recipients: Array<{
      memberId: string;
      name: string;
      email: string;
      viewedAt: string | null;
      completedAt: string | null;
    }>;
  };
};

type Options = {
  member: { id: string; role: string; isTeamLeader: boolean; name: string };
  capabilities: { canManage: boolean; canBroadcastOrganization: boolean };
  clients: Array<{ id: string; name: string; document: string | null }>;
  members: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    isTeamLeader: boolean;
  }>;
};

const kindLabels = {
  ALERT: "Alerta",
  REMINDER: "Lembrete",
  NOTE: "Nota pessoal",
};

const priorityLabels = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const priorityColors = {
  LOW: "gray",
  NORMAL: "blue",
  HIGH: "orange",
  CRITICAL: "red",
};

function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return "Sem prazo";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function NoticeCard({
  notice,
  management,
  currentMemberId,
  onAction,
  onDelete,
}: {
  notice: Notice;
  management?: boolean;
  currentMemberId: string;
  onAction: (id: string, action: string) => void;
  onDelete: (id: string) => void;
}) {
  const [showAudience, setShowAudience] = useState(false);
  const isExpired = !!notice.expiresAt && new Date(notice.expiresAt) < new Date();
  const isAuthor = notice.author.id === currentMemberId;
  const complete = !!notice.mine?.completedAt;
  const audienceProgress = notice.audience.total
    ? Math.round((notice.audience.viewed / notice.audience.total) * 100)
    : 0;

  const icon =
    notice.kind === "NOTE" ? (
      <IconNotes size={22} />
    ) : notice.kind === "REMINDER" ? (
      <IconClock size={22} />
    ) : (
      <IconBell size={22} />
    );

  return (
    <Paper withBorder radius="lg" p="lg" className={styles.noticeCard}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Group align="flex-start" wrap="nowrap">
          <ThemeIcon
            size={44}
            radius="md"
            variant="light"
            color={priorityColors[notice.priority]}
          >
            {icon}
          </ThemeIcon>
          <div>
            <Group gap={7} mb={5}>
              <Badge size="sm" variant="light" color={priorityColors[notice.priority]}>
                {priorityLabels[notice.priority]}
              </Badge>
              <Badge size="sm" variant="outline" color="gray">
                {kindLabels[notice.kind]}
              </Badge>
              {notice.scope === "GENERAL" && (
                <Badge size="sm" variant="light" color="violet">
                  Geral
                </Badge>
              )}
              {notice.scope === "MEMBERS" && (
                <Badge size="sm" variant="light" color="teal">
                  Direcionado
                </Badge>
              )}
              {isExpired && <Badge color="gray">Expirado</Badge>}
            </Group>
            <Title order={4}>{notice.title}</Title>
            <Text size="xs" c="dimmed" mt={4}>
              Criado por {notice.author.name}
            </Text>
          </div>
        </Group>

        {isAuthor && (
          <Tooltip label="Excluir aviso">
            <ActionIcon
              variant="subtle"
              color="red"
              onClick={() => onDelete(notice.id)}
              aria-label="Excluir aviso"
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>

      {notice.body && (
        <Text mt="md" size="sm" className={styles.noticeBody}>
          {notice.body}
        </Text>
      )}

      {notice.clients.length > 0 && (
        <Group gap={6} mt="md">
          <IconUsers size={16} color="var(--mantine-color-blue-6)" />
          <Text size="xs" fw={700}>
            {notice.targetsAllClients
              ? "Todos os clientes"
              : notice.clients.slice(0, 3).map((client) => client.name).join(", ")}
            {!notice.targetsAllClients && notice.clients.length > 3
              ? ` +${notice.clients.length - 3}`
              : ""}
          </Text>
        </Group>
      )}

      {notice.scope === "MEMBERS" && notice.audience.recipients.length > 0 && (
        <Group gap={6} mt="md">
          <IconUsers size={16} color="var(--mantine-color-teal-6)" />
          <Text size="xs" fw={700}>
            Para: {notice.audience.recipients.map((recipient) => recipient.name).join(", ")}
          </Text>
        </Group>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} mt="md" spacing="xs">
        <Group gap={7}>
          <IconCalendarDue size={16} color="var(--mantine-color-gray-6)" />
          <Text size="xs" c="dimmed">
            Prazo: <strong>{formatDate(notice.dueAt)}</strong>
          </Text>
        </Group>
        <Group gap={7}>
          <IconClock size={16} color="var(--mantine-color-gray-6)" />
          <Text size="xs" c="dimmed">
            Expira: <strong>{formatDate(notice.expiresAt)}</strong>
          </Text>
        </Group>
      </SimpleGrid>

      {management && (
        <div className={styles.audienceBox}>
          <Group justify="space-between" mb={7}>
            <Group gap={7}>
              <IconEye size={17} />
              <Text size="sm" fw={700}>
                {notice.audience.viewed} de {notice.audience.total} visualizaram
              </Text>
            </Group>
            <Button
              variant="subtle"
              size="compact-xs"
              onClick={() => setShowAudience((value) => !value)}
            >
              {showAudience ? "Ocultar pessoas" : "Ver pessoas"}
            </Button>
          </Group>
          <Progress value={audienceProgress} size="sm" radius="xl" />
          <Text size="xs" c="dimmed" mt={7}>
            {notice.audience.completed} concluíram · {notice.audience.pendingCompletion} pendentes
          </Text>

          {showAudience && (
            <Stack gap={6} mt="md">
              {notice.audience.recipients.map((recipient) => (
                <Group key={recipient.memberId} justify="space-between">
                  <div>
                    <Text size="xs" fw={700}>{recipient.name}</Text>
                    <Text size="xs" c="dimmed">{recipient.email}</Text>
                  </div>
                  <Group gap={5}>
                    <Badge color={recipient.viewedAt ? "blue" : "gray"} variant="light">
                      {recipient.viewedAt ? "Viu" : "Não viu"}
                    </Badge>
                    <Badge color={recipient.completedAt ? "green" : "orange"} variant="light">
                      {recipient.completedAt ? "Concluiu" : "Pendente"}
                    </Badge>
                  </Group>
                </Group>
              ))}
            </Stack>
          )}
        </div>
      )}

      <Divider my="md" />
      <Group justify="space-between">
        <Text size="xs" c="dimmed">
          Criado em {formatDate(notice.createdAt)}
        </Text>
        <Group gap="xs">
          {!management && notice.mine && !isExpired && (
            <Button
              size="xs"
              variant={complete ? "light" : "filled"}
              color={complete ? "gray" : "green"}
              leftSection={complete ? <IconRefresh size={15} /> : <IconCheck size={15} />}
              onClick={() => onAction(notice.id, complete ? "reopen" : "complete")}
            >
              {complete ? "Reabrir" : "Marcar como concluído"}
            </Button>
          )}
          {management && isAuthor && !notice.closedAt && (
            <Button
              size="xs"
              variant="light"
              color="green"
              leftSection={<IconCircleCheck size={15} />}
              onClick={() => onAction(notice.id, "close")}
            >
              Finalizar para todos
            </Button>
          )}
        </Group>
      </Group>
    </Paper>
  );
}

export default function AvisosPage() {
  const [options, setOptions] = useState<Options | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [managementNotices, setManagementNotices] = useState<Notice[]>([]);
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [kind, setKind] = useState("ALERT");
  const [scope, setScope] = useState("PERSONAL");
  const [priority, setPriority] = useState("NORMAL");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [allClients, setAllClients] = useState(false);
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [targetMemberId, setTargetMemberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const optionsResponse = await fetch("/api/notices?view=options", {
        cache: "no-store",
      });
      const optionsPayload = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(optionsPayload.error || "Falha ao carregar avisos.");

      const inboxResponse = await fetch(`/api/notices?status=${status}`, {
        cache: "no-store",
      });
      const inboxPayload = await inboxResponse.json();
      if (!inboxResponse.ok) throw new Error(inboxPayload.error || "Falha ao carregar avisos.");

      setOptions(optionsPayload);
      setNotices(inboxPayload.notices || []);

      if (optionsPayload.capabilities?.canManage) {
        const managementResponse = await fetch("/api/notices?view=management", {
          cache: "no-store",
        });
        const managementPayload = await managementResponse.json();
        if (managementResponse.ok) setManagementNotices(managementPayload.notices || []);
      }
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Avisos",
        message: error instanceof Error ? error.message : "Falha ao carregar a central.",
      });
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unseen = notices.filter((notice) => notice.mine && !notice.mine.viewedAt);
    if (unseen.length === 0) return;

    unseen.forEach((notice) => {
      void fetch(`/api/notices/${notice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "viewed" }),
      });
    });
    const viewedAt = new Date().toISOString();
    setNotices((current) =>
      current.map((notice) =>
        unseen.some((item) => item.id === notice.id) && notice.mine
          ? { ...notice, mine: { ...notice.mine, viewedAt } }
          : notice,
      ),
    );
  }, [notices]);

  const resetForm = () => {
    setKind("ALERT");
    setScope("PERSONAL");
    setPriority("NORMAL");
    setTitle("");
    setBody("");
    setDueAt("");
    setExpiresAt(toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));
    setAllClients(false);
    setClientIds([]);
    setTargetMemberId(null);
  };

  const openCreateModal = () => {
    resetForm();
    setOpened(true);
  };

  async function createNotice() {
    setSaving(true);
    try {
      const response = await fetch("/api/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          scope,
          priority,
          title,
          body,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          allClients,
          clientIds,
          memberIds: targetMemberId ? [targetMemberId] : [],
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível criar o aviso.");
      notifications.show({ color: "green", title: "Aviso criado", message: "O aviso já está disponível para os destinatários." });
      setOpened(false);
      resetForm();
      await load();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Não foi possível criar",
        message: error instanceof Error ? error.message : "Revise os dados informados.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function actionNotice(id: string, action: string) {
    try {
      const response = await fetch(`/api/notices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o aviso.");
      await load();
    } catch (error) {
      notifications.show({ color: "red", title: "Avisos", message: error instanceof Error ? error.message : "Falha ao atualizar." });
    }
  }

  async function deleteNotice(id: string) {
    try {
      const response = await fetch(`/api/notices/${id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir o aviso.");
      setDeleteId(null);
      await load();
    } catch (error) {
      notifications.show({ color: "red", title: "Avisos", message: error instanceof Error ? error.message : "Falha ao excluir." });
    }
  }

  const clientOptions = useMemo(
    () =>
      (options?.clients || []).map((client) => ({
        value: client.id,
        label: client.document ? `${client.name} · ${client.document}` : client.name,
      })),
    [options],
  );

  const memberOptions = useMemo(
    () =>
      (options?.members || []).map((member) => ({
        value: member.id,
        label: `${member.name} · ${member.email}`,
      })),
    [options],
  );

  return (
    <Stack gap="xl" className={styles.page}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1.1}>Organização</Text>
          <Title order={1}>Central de Avisos</Title>
        </div>
        <Button leftSection={<IconBellPlus size={18} />} onClick={openCreateModal}>
          Novo aviso
        </Button>
      </Group>

      {loading ? (
        <Group justify="center" py={80}><Loader /></Group>
      ) : (
        <Tabs defaultValue="mine">
          <Tabs.List>
            <Tabs.Tab value="mine" leftSection={<IconBell size={16} />}>Meus avisos</Tabs.Tab>
            {options?.capabilities.canManage && (
              <Tabs.Tab value="management" leftSection={<IconEye size={16} />}>Acompanhamento</Tabs.Tab>
            )}
          </Tabs.List>

          <Tabs.Panel value="mine" pt="lg">
            <Group gap="xs" mb="lg">
              {[
                ["active", "Em aberto"],
                ["completed", "Concluídos"],
                ["expired", "Expirados"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  size="xs"
                  variant={status === value ? "filled" : "light"}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </Button>
              ))}
            </Group>
            {notices.length > 0 ? (
              <SimpleGrid cols={{ base: 1, xl: 2 }}>
                {notices.map((notice) => (
                  <NoticeCard
                    key={notice.id}
                    notice={notice}
                    currentMemberId={options?.member.id || ""}
                    onAction={actionNotice}
                    onDelete={setDeleteId}
                  />
                ))}
              </SimpleGrid>
            ) : (
              <Paper withBorder radius="lg" p={48} ta="center">
                <ThemeIcon size={52} radius="xl" variant="light" color="gray"><IconBell size={26} /></ThemeIcon>
                <Title order={4} mt="md">Nenhum aviso nesta lista</Title>
                <Text size="sm" c="dimmed" mt={5}>Seus próximos alertas e lembretes aparecerão aqui.</Text>
              </Paper>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="management" pt="lg">
            <Stack gap="md">
              {managementNotices.length > 0 ? managementNotices.map((notice) => (
                <NoticeCard
                  key={notice.id}
                  notice={notice}
                  management
                  currentMemberId={options?.member.id || ""}
                  onAction={actionNotice}
                  onDelete={setDeleteId}
                />
              )) : (
                <Paper withBorder radius="lg" p={48} ta="center">
                  <IconEye size={30} color="var(--mantine-color-gray-5)" />
                  <Title order={4} mt="md">Nenhum aviso coletivo criado</Title>
                  <Text size="sm" c="dimmed">Crie um aviso para clientes, equipe ou toda a organização.</Text>
                </Paper>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      )}

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={<Text fw={800} size="lg">Criar novo aviso</Text>}
        size="lg"
        centered
      >
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label="Tipo"
              value={kind}
              onChange={(value) => setKind(value || "ALERT")}
              data={[
                { value: "ALERT", label: "Alerta" },
                { value: "REMINDER", label: "Lembrete" },
                { value: "NOTE", label: "Bloco de notas pessoal" },
              ]}
            />
            <Select
              label="Prioridade"
              value={priority}
              onChange={(value) => setPriority(value || "NORMAL")}
              data={[
                { value: "LOW", label: "Baixa" },
                { value: "NORMAL", label: "Normal" },
                { value: "HIGH", label: "Alta" },
                { value: "CRITICAL", label: "Crítica" },
              ]}
            />
          </SimpleGrid>

          <Select
            label="Quem deve receber"
            value={scope}
            onChange={(value) => setScope(value || "PERSONAL")}
            data={[
              { value: "PERSONAL", label: "Somente eu" },
              ...(options?.capabilities.canManage
                ? [
                    { value: "MEMBERS", label: "Um colaborador específico" },
                    { value: "CLIENTS", label: "Responsáveis pelos clientes selecionados" },
                    {
                      value: "GENERAL",
                      label: options.capabilities.canBroadcastOrganization
                        ? "Toda a organização"
                        : "Minha equipe",
                    },
                  ]
                : []),
            ]}
          />

          {scope === "MEMBERS" && (
            <Paper withBorder radius="md" p="md">
              <Select
                label="Colaborador"
                description="Somente esta pessoa receberá o alerta. Você acompanhará a visualização e a conclusão."
                placeholder="Selecione o colaborador"
                searchable
                clearable
                data={memberOptions}
                value={targetMemberId}
                onChange={setTargetMemberId}
                required
                maxDropdownHeight={260}
              />
            </Paper>
          )}

          {scope === "CLIENTS" && (
            <Paper withBorder radius="md" p="md">
              <Checkbox
                label="Selecionar todos os clientes ativos"
                checked={allClients}
                onChange={(event) => setAllClients(event.currentTarget.checked)}
                mb="sm"
              />
              <MultiSelect
                label="Clientes"
                placeholder="Selecione um ou mais clientes"
                searchable
                clearable
                disabled={allClients}
                data={clientOptions}
                value={clientIds}
                onChange={setClientIds}
                maxDropdownHeight={260}
              />
              <Text size="xs" c="dimmed" mt={8}>
                O aviso será entregue aos responsáveis cadastrados nesses clientes e aos respectivos líderes.
              </Text>
            </Paper>
          )}

          <TextInput
            label="Título"
            placeholder="Ex.: Certificado digital vence em breve"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={120}
            required
          />
          <Textarea
            label="Descrição"
            placeholder="Descreva o que precisa ser conferido ou lembrado."
            value={body}
            onChange={(event) => setBody(event.currentTarget.value)}
            minRows={4}
            maxLength={3000}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput
              type="datetime-local"
              label="Prazo para realizar"
              value={dueAt}
              onChange={(event) => setDueAt(event.currentTarget.value)}
            />
            <TextInput
              type="datetime-local"
              label={kind === "NOTE" ? "Expiração (opcional)" : "Expira em"}
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.currentTarget.value)}
              required={kind !== "NOTE"}
            />
          </SimpleGrid>

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={() => setOpened(false)}>Cancelar</Button>
            <Button loading={saving} onClick={createNotice} leftSection={<IconBellPlus size={17} />}>
              Criar aviso
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={!!deleteId}
        onClose={() => setDeleteId(null)}
        title={<Text fw={800} size="lg">Excluir aviso?</Text>}
        centered
        size="sm"
      >
        <Text size="sm" c="dimmed">
          Essa ação remove o aviso e todo o histórico de visualização dos destinatários.
        </Text>
        <Group justify="flex-end" mt="xl">
          <Button variant="default" onClick={() => setDeleteId(null)}>Cancelar</Button>
          <Button
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={() => deleteId && void deleteNotice(deleteId)}
          >
            Excluir definitivamente
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
