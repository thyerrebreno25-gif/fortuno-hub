/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconBuildingBank,
  IconCheck,
  IconLink,
  IconRefresh,
  IconSearch,
  IconUnlink,
} from "@tabler/icons-react";

type Connection = {
  status: string;
  active: boolean;
  externalTenantName: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  updatedAt: string;
};

type ClientConnection = {
  id: string;
  name: string;
  document: string | null;
  connection: Connection | null;
};

type ConnectionsResponse = {
  configured: boolean;
  canManage: boolean;
  clients: ClientConnection[];
  error?: string;
};

function isConnected(client: ClientConnection) {
  return Boolean(
    client.connection?.active && client.connection.status === "CONNECTED",
  );
}

function formatDocument(document: string | null) {
  const digits = document?.replace(/\D/g, "") || "";
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5",
    );
  }
  if (digits.length === 11) {
    return digits.replace(
      /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
      "$1.$2.$3-$4",
    );
  }
  return document || "Documento não informado";
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

function connectionHref(clientId: string) {
  return `/api/integrations/conta-azul/connect?clientId=${encodeURIComponent(clientId)}&returnTo=connections`;
}

export default function ContaAzulConnectionsPage() {
  const [data, setData] = useState<ConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        "/api/integrations/conta-azul/connections",
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => ({}))) as ConnectionsResponse;

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar os vínculos.");
      }

      setData(payload);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os vínculos.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();

    const params = new URLSearchParams(window.location.search);
    if (params.get("ca") === "connected") {
      notifications.show({
        color: "green",
        title: "Conta Azul conectado",
        message: "O vínculo do cliente foi criado com sucesso.",
      });
    } else if (params.get("ca_error")) {
      notifications.show({
        color: "red",
        title: "Vínculo não concluído",
        message: "Confira a autorização no Conta Azul e tente novamente.",
      });
    }

    if (params.has("ca") || params.has("ca_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [load]);

  const filteredClients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return data?.clients || [];

    return (data?.clients || []).filter((client) =>
      [client.name, client.document || "", client.connection?.externalTenantName || ""]
        .join(" ")
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [data?.clients, search]);

  const summary = useMemo(() => {
    const clients = data?.clients || [];
    const connected = clients.filter(isConnected).length;
    const withError = clients.filter(
      (client) => Boolean(client.connection?.lastError) && !isConnected(client),
    ).length;
    return {
      total: clients.length,
      connected,
      pending: clients.length - connected,
      withError,
      percentage: clients.length
        ? Math.round((connected / clients.length) * 100)
        : 0,
    };
  }, [data?.clients]);

  const nextPending = data?.clients.find((client) => !isConnected(client));

  async function disconnect(client: ClientConnection) {
    const confirmed = window.confirm(
      `Desvincular ${client.name} do Conta Azul?`,
    );
    if (!confirmed) return;

    setDisconnectingId(client.id);
    try {
      const response = await fetch(
        `/api/integrations/conta-azul/status?clientId=${encodeURIComponent(client.id)}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível remover o vínculo.");
      }

      notifications.show({
        color: "green",
        title: "Vínculo removido",
        message: payload.message || "Cliente desconectado do Conta Azul.",
      });
      await load();
    } catch (cause) {
      notifications.show({
        color: "red",
        title: "Não foi possível desvincular",
        message: cause instanceof Error ? cause.message : "Tente novamente.",
      });
    } finally {
      setDisconnectingId(null);
    }
  }

  if (loading && !data) {
    return (
      <Center mih={460}>
        <Stack align="center">
          <Loader />
          <Text c="dimmed">Carregando vínculos do Conta Azul...</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={3}>
          <Text size="xs" fw={700} c="blue" tt="uppercase" lts={0.8}>
            Integrações
          </Text>
          <Title order={1}>Vínculos Conta Azul</Title>
        </Stack>

        <Group>
          <Button
            variant="default"
            leftSection={<IconRefresh size={17} />}
            onClick={() => void load()}
            loading={loading}
          >
            Atualizar
          </Button>
          {nextPending && data?.canManage && data.configured && (
            <Button
              component="a"
              href={connectionHref(nextPending.id)}
              leftSection={<IconLink size={17} />}
            >
              Vincular próximo cliente
            </Button>
          )}
        </Group>
      </Group>

      {error && <Alert color="red">{error}</Alert>}
      {data && !data.configured && (
        <Alert
          color="orange"
          icon={<IconAlertTriangle size={18} />}
          title="Aplicação Conta Azul não configurada"
        >
          Configure as credenciais de produção no ambiente antes de iniciar os
          vínculos.
        </Alert>
      )}

      <Alert color="blue" icon={<IconBuildingBank size={20} />}>
        Você pode usar sempre o mesmo login do escritório. Por segurança, o
        Conta Azul pedirá a autorização de cada empresa separadamente; não é
        necessário cadastrar novas chaves nem repetir configurações no Fortuno
        Hub.
      </Alert>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
        <SummaryCard label="Clientes ativos" value={summary.total} />
        <SummaryCard label="Vinculados" value={summary.connected} color="green" />
        <SummaryCard label="A vincular" value={summary.pending} color="orange" />
        <SummaryCard label="Com atenção" value={summary.withError} color="red" />
      </SimpleGrid>

      <Paper withBorder radius="lg" p="lg">
        <Group justify="space-between" mb="sm">
          <Stack gap={1}>
            <Text fw={800}>Progresso dos vínculos</Text>
            <Text size="sm" c="dimmed">
              {summary.connected} de {summary.total} clientes conectados
            </Text>
          </Stack>
          <Text fw={800} c="blue">
            {summary.percentage}%
          </Text>
        </Group>
        <Progress value={summary.percentage} size="lg" radius="xl" />
      </Paper>

      <Paper withBorder radius="lg" style={{ overflow: "hidden" }}>
        <Group justify="space-between" p="lg">
          <Stack gap={1}>
            <Title order={3}>Clientes</Title>
            <Text size="sm" c="dimmed">
              O vínculo criado aqui vale para Notas de compra, Faturas e
              Adquirentes.
            </Text>
          </Stack>
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Buscar cliente ou empresa"
            leftSection={<IconSearch size={16} />}
            w={{ base: "100%", sm: 330 }}
          />
        </Group>

        <Table.ScrollContainer minWidth={850}>
          <Table verticalSpacing="md" horizontalSpacing="lg">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Cliente no Fortuno Hub</Table.Th>
                <Table.Th>Empresa autorizada</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Última atualização</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filteredClients.map((client) => {
                const connected = isConnected(client);
                return (
                  <Table.Tr key={client.id}>
                    <Table.Td>
                      <Text fw={700}>{client.name}</Text>
                      <Text size="xs" c="dimmed">
                        {formatDocument(client.document)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" fw={connected ? 600 : 400}>
                        {client.connection?.externalTenantName || "Ainda não autorizada"}
                      </Text>
                      {client.connection?.lastError && !connected && (
                        <Text size="xs" c="red" lineClamp={1}>
                          {client.connection.lastError}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={connected ? "green" : "gray"}
                        variant="light"
                        leftSection={connected ? <IconCheck size={12} /> : undefined}
                      >
                        {connected ? "Vinculado" : "Não vinculado"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" c="dimmed">
                        {client.connection?.updatedAt
                          ? formatDate(client.connection.updatedAt)
                          : "—"}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group justify="flex-end" wrap="nowrap">
                        {data?.canManage && (
                          <Button
                            component="a"
                            href={connectionHref(client.id)}
                            variant={connected ? "light" : "filled"}
                            leftSection={<IconLink size={16} />}
                            disabled={!data.configured}
                          >
                            {connected ? "Reconectar" : "Vincular"}
                          </Button>
                        )}
                        {connected && data?.canManage && (
                          <Button
                            color="red"
                            variant="subtle"
                            leftSection={<IconUnlink size={16} />}
                            loading={disconnectingId === client.id}
                            onClick={() => void disconnect(client)}
                          >
                            Desvincular
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {!filteredClients.length && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Center py={45}>
                      <Text c="dimmed">
                        {search
                          ? "Nenhum cliente encontrado para esta busca."
                          : "Nenhum cliente ativo cadastrado."}
                      </Text>
                    </Center>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  );
}

function SummaryCard({
  label,
  value,
  color = "blue",
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between">
        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Title order={2}>{value}</Title>
        </Stack>
        <ThemeIcon color={color} variant="light" size={42} radius="md">
          <IconBuildingBank size={22} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}
