"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconActivity,
  IconBuilding,
  IconCheck,
  IconEdit,
  IconKey,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";
import { PermissionsManager } from "@/components/permissions/permissions-manager";

type UserRole = "MASTER" | "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT";

type SettingsData = {
  currentUser: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    canAdminister: boolean;
  };
  organization: {
    id: string;
    name: string;
    document: string | null;
    createdAt: string;
    updatedAt: string;
  };
  members: Array<{
    id: string;
    role: UserRole;
    createdAt: string;
    user: {
      id: string;
      name: string;
      email: string;
      updatedAt: string;
    };
  }>;
  summary: {
    activeClients: number;
    imports: number;
    openTickets: number;
    activeOnboardings: number;
  };
  audit: Array<{
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    createdAt: string;
    user: {
      id: string;
      name: string;
      email: string;
    };
  }>;
  integrationStatus: {
    supabase: boolean;
    userInvites: boolean;
    database: boolean;
  };
};

const roleLabels: Record<UserRole, string> = {
  MASTER: "Master",
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  CLIENT: "Cliente",
};

const roleColors: Record<UserRole, string> = {
  MASTER: "grape",
  ADMIN: "violet",
  MANAGER: "blue",
  OPERATOR: "green",
  CLIENT: "gray",
};

const roleOptions = [
  { value: "ADMIN", label: "Administrador" },
  { value: "MANAGER", label: "Gestor" },
  { value: "OPERATOR", label: "Operador" },
  { value: "CLIENT", label: "Cliente" },
];



function formatDocument(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ConfiguracoesPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");

  const [organizationName, setOrganizationName] = useState("");
  const [document, setDocument] = useState("");
  const [userName, setUserName] = useState("");

  const [memberModal, setMemberModal] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<string | null>("OPERATOR");

  const [passwordModal, setPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const payload = (await response.json()) as SettingsData & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar.");
      }

      setData(payload);
      setOrganizationName(payload.organization.name);
      setDocument(formatDocument(payload.organization.document || ""));
      setUserName(payload.currentUser.name);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar as configurações.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data || !term) return data?.members ?? [];

    return data.members.filter(
      (item) =>
        item.user.name.toLowerCase().includes(term) ||
        item.user.email.toLowerCase().includes(term) ||
        roleLabels[item.role].toLowerCase().includes(term),
    );
  }, [data, search]);

  async function saveOrganization() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName,
          document,
          userName,
        }),
      });

      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível salvar.");
      }

      setSuccess(payload.message || "Configurações salvas.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível salvar.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openInvite() {
    setEditingMemberId(null);
    setMemberName("");
    setMemberEmail("");
    setMemberRole("OPERATOR");
    setMemberModal(true);
  }

  function openEdit(member: SettingsData["members"][number]) {
    setEditingMemberId(member.id);
    setMemberName(member.user.name);
    setMemberEmail(member.user.email);
    setMemberRole(member.role);
    setMemberModal(true);
  }

  async function saveMember() {
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        editingMemberId
          ? `/api/settings/members/${editingMemberId}`
          : "/api/settings/members",
        {
          method: editingMemberId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: memberName,
            email: memberEmail,
            role: memberRole,
          }),
        },
      );

      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível salvar o usuário.");
      }

      setMemberModal(false);
      setSuccess(payload.message || "Usuário salvo.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o usuário.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(id: string) {
    const confirmed = window.confirm(
      "Remover o acesso deste usuário à organização?",
    );
    if (!confirmed) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/settings/members/${id}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível remover.");
      }

      setSuccess(payload.message || "Acesso removido.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível remover.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      setError("A nova senha deve possuir pelo menos 8 caracteres.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const supabase = createSupabaseClient();
      const { error: passwordError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (passwordError) throw passwordError;

      setNewPassword("");
      setPasswordModal(false);
      setSuccess("Senha atualizada com sucesso.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível alterar a senha.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return (
      <Center mih={420}>
        <Stack align="center">
          <Loader />
          <Text c="dimmed">Carregando configurações...</Text>
        </Stack>
      </Center>
    );
  }

  if (!data) {
    return <Alert color="red">{error || "Configurações indisponíveis."}</Alert>;
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={0.8}>
            Fortuno Hub
          </Text>
          <Title order={2}>Configurações</Title>
          <Text size="sm" c="dimmed">
            Organização, equipe, segurança e auditoria da plataforma.
          </Text>
        </Stack>

        <Badge color={roleColors[data.currentUser.role]} variant="light" size="lg">
          {roleLabels[data.currentUser.role]}
        </Badge>
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
          <Metric label="Equipe" value={data.members.length} />
          <Metric label="Clientes ativos" value={data.summary.activeClients} bordered />
          <Metric label="Importações" value={data.summary.imports} bordered />
          <Metric
            label="Operação aberta"
            value={data.summary.openTickets + data.summary.activeOnboardings}
            bordered
          />
        </SimpleGrid>
      </Paper>

      <Tabs defaultValue="organization">
        <Tabs.List>
          <Tabs.Tab value="organization" leftSection={<IconBuilding size={16} />}>
            Organização
          </Tabs.Tab>
          <Tabs.Tab value="team" leftSection={<IconUsers size={16} />}>
            Equipe
          </Tabs.Tab>
          <Tabs.Tab value="permissions" leftSection={<IconShieldCheck size={16} />}>
            Perfis
          </Tabs.Tab>
          <Tabs.Tab value="security" leftSection={<IconKey size={16} />}>
            Segurança
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconActivity size={16} />}>
            Auditoria
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="organization" pt="lg">
          <SimpleGrid cols={{ base: 1, xl: 2 }}>
            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Stack gap={2}>
                  <Title order={4}>Dados da organização</Title>
                  <Text size="sm" c="dimmed">
                    Informações utilizadas em todo o ambiente do Fortuno Hub.
                  </Text>
                </Stack>

                <TextInput
                  label="Nome da organização"
                  value={organizationName}
                  onChange={(event) =>
                    setOrganizationName(event.currentTarget.value)
                  }
                  disabled={!data.currentUser.canAdminister}
                  required
                />

                <TextInput
                  label="CNPJ"
                  value={document}
                  onChange={(event) =>
                    setDocument(formatDocument(event.currentTarget.value))
                  }
                  placeholder="00.000.000/0000-00"
                  disabled={!data.currentUser.canAdminister}
                />

                <TextInput
                  label="Seu nome"
                  value={userName}
                  onChange={(event) => setUserName(event.currentTarget.value)}
                  disabled={!data.currentUser.canAdminister}
                />

                <Group justify="flex-end">
                  <Button
                    onClick={() => void saveOrganization()}
                    loading={saving}
                    disabled={!data.currentUser.canAdminister}
                  >
                    Salvar alterações
                  </Button>
                </Group>
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Stack gap={2}>
                  <Title order={4}>Ambiente</Title>
                  <Text size="sm" c="dimmed">
                    Estado das conexões utilizadas pelo sistema.
                  </Text>
                </Stack>

                <Integration
                  label="Banco PostgreSQL"
                  active={data.integrationStatus.database}
                />
                <Integration
                  label="Autenticação Supabase"
                  active={data.integrationStatus.supabase}
                />
                <Integration
                  label="Convites por e-mail"
                  active={data.integrationStatus.userInvites}
                  detail={
                    data.integrationStatus.userInvites
                      ? "Service Role configurada"
                      : "Adicione SUPABASE_SERVICE_ROLE_KEY ao .env"
                  }
                />

                <Text size="xs" c="dimmed">
                  Organização criada em {formatDate(data.organization.createdAt)}.
                </Text>
              </Stack>
            </Paper>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="team" pt="lg">
          <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
            <Group justify="space-between" p="lg">
              <Stack gap={1}>
                <Title order={4}>Equipe da organização</Title>
                <Text size="sm" c="dimmed">
                  Usuários reais vinculados ao ambiente.
                </Text>
              </Stack>

              <Group>
                <TextInput
                  placeholder="Buscar usuário"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  leftSection={<IconSearch size={16} />}
                />
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={openInvite}
                  disabled={!data.currentUser.canAdminister}
                >
                  Convidar usuário
                </Button>
              </Group>
            </Group>

            <ScrollArea>
              <Table miw={850} verticalSpacing="sm" horizontalSpacing="lg">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Usuário</Table.Th>
                    <Table.Th>Perfil</Table.Th>
                    <Table.Th>Vinculado em</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filteredMembers.map((member) => (
                    <Table.Tr key={member.id}>
                      <Table.Td>
                        <Group gap="sm">
                          <Avatar color={roleColors[member.role]}>
                            {member.user.name.slice(0, 1).toUpperCase()}
                          </Avatar>
                          <Stack gap={0}>
                            <Text fw={600} size="sm">{member.user.name}</Text>
                            <Text size="xs" c="dimmed">{member.user.email}</Text>
                          </Stack>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Badge color={roleColors[member.role]} variant="light">
                          {roleLabels[member.role]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>{formatDate(member.createdAt)}</Table.Td>
                      <Table.Td>
                        <Group justify="flex-end" gap={4}>
                          <ActionIcon
                            variant="subtle"
                            onClick={() => openEdit(member)}
                            disabled={
                              !data.currentUser.canAdminister ||
                              member.role === "MASTER"
                            }
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => void removeMember(member.id)}
                            disabled={
                              !data.currentUser.canAdminister ||
                              member.role === "MASTER" ||
                              member.user.id === data.currentUser.id
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="permissions" pt="lg">
          <PermissionsManager />
        </Tabs.Panel>

        <Tabs.Panel value="security" pt="lg">
          <SimpleGrid cols={{ base: 1, xl: 2 }}>
            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Stack gap={2}>
                  <Title order={4}>Senha</Title>
                  <Text size="sm" c="dimmed">
                    Altere a senha do usuário autenticado.
                  </Text>
                </Stack>
                <Button variant="default" onClick={() => setPasswordModal(true)}>
                  Alterar minha senha
                </Button>
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Stack gap={2}>
                  <Title order={4}>Sessão e proteção</Title>
                  <Text size="sm" c="dimmed">
                    Autenticação gerenciada pelo Supabase.
                  </Text>
                </Stack>
                <Integration label="Sessão autenticada" active />
                <Integration label="Isolamento por organização" active />
                <Integration label="Auditoria de alterações" active />
              </Stack>
            </Paper>
          </SimpleGrid>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="lg">
          <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
            <Group justify="space-between" p="lg">
              <Stack gap={1}>
                <Title order={4}>Auditoria</Title>
                <Text size="sm" c="dimmed">
                  Últimas 100 ações registradas pelos usuários da organização.
                </Text>
              </Stack>
              <ActionIcon variant="default" size="lg" onClick={() => void load()}>
                <IconRefresh size={17} />
              </ActionIcon>
            </Group>

            <ScrollArea>
              <Table miw={850} verticalSpacing="sm" horizontalSpacing="lg">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Usuário</Table.Th>
                    <Table.Th>Ação</Table.Th>
                    <Table.Th>Entidade</Table.Th>
                    <Table.Th>Data</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.audit.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Text fw={600} size="sm">{item.user.name}</Text>
                        <Text size="xs" c="dimmed">{item.user.email}</Text>
                      </Table.Td>
                      <Table.Td>{item.action}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" color="gray">{item.entity}</Badge>
                      </Table.Td>
                      <Table.Td>{formatDate(item.createdAt)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={memberModal}
        onClose={() => setMemberModal(false)}
        title={editingMemberId ? "Editar usuário" : "Convidar usuário"}
        centered
      >
        <Stack gap="md">
          <TextInput
            label="Nome"
            value={memberName}
            onChange={(event) => setMemberName(event.currentTarget.value)}
            required
          />
          <TextInput
            label="E-mail"
            value={memberEmail}
            onChange={(event) => setMemberEmail(event.currentTarget.value)}
            disabled={Boolean(editingMemberId)}
            required
          />
          <Select
            label="Perfil"
            data={roleOptions}
            value={memberRole}
            onChange={setMemberRole}
            required
          />

          {!editingMemberId && !data.integrationStatus.userInvites && (
            <Alert color="orange">
              Para enviar convites, configure SUPABASE_SERVICE_ROLE_KEY no .env.
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setMemberModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void saveMember()}
              loading={saving}
              disabled={
                memberName.trim().length < 2 ||
                !memberRole ||
                (!editingMemberId && !memberEmail.includes("@"))
              }
            >
              {editingMemberId ? "Salvar usuário" : "Enviar convite"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={passwordModal}
        onClose={() => setPasswordModal(false)}
        title="Alterar senha"
        centered
      >
        <Stack>
          <TextInput
            label="Nova senha"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.currentTarget.value)}
            description="Utilize pelo menos 8 caracteres."
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPasswordModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void changePassword()}
              loading={saving}
              disabled={newPassword.length < 8}
            >
              Atualizar senha
            </Button>
          </Group>
        </Stack>
      </Modal>
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
      p="lg"
      gap={3}
      style={{
        borderLeft: bordered
          ? "1px solid var(--mantine-color-gray-2)"
          : undefined,
      }}
    >
      <Text size="xs" c="dimmed" fw={600}>{label.toUpperCase()}</Text>
      <Text fw={750} fz={26}>{value}</Text>
    </Stack>
  );
}

function Integration({
  label,
  active,
  detail,
}: {
  label: string;
  active: boolean;
  detail?: string;
}) {
  return (
    <Group justify="space-between">
      <Stack gap={0}>
        <Text size="sm" fw={600}>{label}</Text>
        {detail && <Text size="xs" c="dimmed">{detail}</Text>}
      </Stack>
      <Badge
        color={active ? "green" : "orange"}
        variant="light"
        leftSection={active ? <IconCheck size={12} /> : <IconX size={12} />}
      >
        {active ? "Ativo" : "Pendente"}
      </Badge>
    </Group>
  );
}
