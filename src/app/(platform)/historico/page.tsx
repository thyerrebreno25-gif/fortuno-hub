/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertTriangle, IconRefresh, IconSearch } from "@tabler/icons-react";

type Item = {
  id: string;
  source: "IMPORTS" | "OPERATIONS" | "ONBOARDING" | "SERVICE_CENTER" | "SYSTEM";
  title: string;
  description: string;
  entity: string;
  clientName: string | null;
  userName: string;
  status: string;
  createdAt: string;
  href: string;
};

const sourceLabel: Record<Item["source"], string> = {
  IMPORTS: "Importações",
  OPERATIONS: "Operações",
  ONBOARDING: "Onboarding",
  SERVICE_CENTER: "Atendimento",
  SYSTEM: "Sistema",
};
const sourceColor: Record<Item["source"], string> = {
  IMPORTS: "blue",
  OPERATIONS: "cyan",
  ONBOARDING: "violet",
  SERVICE_CENTER: "indigo",
  SYSTEM: "gray",
};
const formatDate = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const humanize = (value: string) => value.replaceAll("_", " ");

export default function HistoricoPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/history?take=400", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar.");
      setItems(payload.items || []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Falha ao carregar histórico.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!source || item.source === source) &&
        (!term ||
          [
            item.title,
            item.description,
            item.clientName || "",
            item.userName,
            sourceLabel[item.source],
          ]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
  }, [items, search, source]);

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Text size="xs" fw={800} c="blue" tt="uppercase">Rastreabilidade</Text>
          <Title order={2}>Histórico unificado</Title>
        </Stack>
        <Button variant="default" leftSection={<IconRefresh size={17} />} onClick={load} loading={loading}>Atualizar</Button>
      </Group>

      {error && <Alert color="red" icon={<IconAlertTriangle size={18} />}>{error}</Alert>}

      <Paper withBorder radius="lg" p="lg">
        <Group grow>
          <TextInput
            placeholder="Pesquisar atividade, cliente ou colaborador"
            leftSection={<IconSearch size={17} />}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
          <Select
            placeholder="Todas as áreas"
            clearable
            value={source}
            onChange={setSource}
            data={Object.entries(sourceLabel).map(([value, label]) => ({ value, label }))}
          />
        </Group>
      </Paper>

      {loading && !items.length ? (
        <Center mih={320}><Loader /></Center>
      ) : (
        <Paper withBorder radius="lg">
          <ScrollArea>
            <Table miw={1050} verticalSpacing="sm" highlightOnHover>
              <Table.Thead><Table.Tr><Table.Th>Data</Table.Th><Table.Th>Origem</Table.Th><Table.Th>Movimentação</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Colaborador</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {filtered.map((item) => (
                  <Table.Tr key={item.id} onClick={() => router.push(item.href as Route)} style={{ cursor: "pointer" }}>
                    <Table.Td>{formatDate(item.createdAt)}</Table.Td>
                    <Table.Td><Badge color={sourceColor[item.source]} variant="light">{sourceLabel[item.source]}</Badge></Table.Td>
                    <Table.Td><Text fw={700} size="sm">{item.title}</Text><Text size="xs" c="dimmed" lineClamp={1}>{item.description}</Text></Table.Td>
                    <Table.Td>{item.clientName || "—"}</Table.Td>
                    <Table.Td>{item.userName}</Table.Td>
                    <Table.Td><Badge color={item.status.includes("FAIL") || item.status === "BLOCKED" ? "red" : item.status.includes("COMPLET") || item.status === "RESOLVED" ? "green" : "gray"} variant="light">{humanize(item.status)}</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
          {!filtered.length && <Text p="xl" ta="center" c="dimmed">Nenhuma movimentação encontrada.</Text>}
        </Paper>
      )}
    </Stack>
  );
}
