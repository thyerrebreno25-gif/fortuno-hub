"use client";

import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconBrandGoogle,
  IconCheck,
  IconChevronDown,
  IconExternalLink,
  IconPlugConnected,
  IconPlugOff,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

type Any = Record<string, any>;

export function GmailConnectionCard() {
  const [data, setData] = useState<Any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/atendimento/gmail/status", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Erro ao consultar Gmail.");
      }
      setData(payload);
      if (!payload.connected) setExpanded(true);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Erro ao consultar Gmail.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(url: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "A operação falhou.");
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "A operação falhou.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Paper withBorder radius="lg" p="sm">
        <Group>
          <Loader size="sm" />
          <Text size="sm">Verificando conexão Gmail...</Text>
        </Group>
      </Paper>
    );
  }
  if (!data) return null;

  const watchActive =
    data.connection?.watchExpiresAt &&
    new Date(data.connection.watchExpiresAt).getTime() > Date.now();

  return (
    <Stack gap="xs">
      {error && (
        <Alert color="red" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      <Paper withBorder radius="lg" p="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon size={36} radius="xl" variant="light">
              <IconBrandGoogle size={19} />
            </ThemeIcon>
            <Stack gap={2}>
              <Group gap="xs">
                <Text fw={700} size="sm">Gmail</Text>
                {data.connected ? (
                  <Badge color="green" variant="light" leftSection={<IconCheck size={10} />}>
                    Conectado
                  </Badge>
                ) : (
                  <Badge color="gray" variant="light">Não conectado</Badge>
                )}
                {watchActive && <Badge color="blue" variant="light">Sincronizado</Badge>}
              </Group>
              <Text size="xs" c="dimmed">
                {data.connected
                  ? data.connection?.email
                  : "Conecte a caixa que receberá os chamados."}
              </Text>
            </Stack>
          </Group>
          <ActionIcon
            variant="subtle"
            aria-label={expanded ? "Recolher conexão" : "Ver detalhes da conexão"}
            onClick={() => setExpanded((current) => !current)}
            style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 160ms ease" }}
          >
            <IconChevronDown size={18} />
          </ActionIcon>
        </Group>

        <Collapse expanded={expanded}>
          <Stack gap="sm" pt="md">
            {data.connection?.lastSyncAt && (
              <Text size="xs" c="dimmed">
                Última sincronização: {new Date(data.connection.lastSyncAt).toLocaleString("pt-BR")}
              </Text>
            )}
            {data.connected && (
              <Text size="xs" c="dimmed">
                {watchActive
                  ? "Novos e-mails da Caixa de entrada são enviados automaticamente ao Hub."
                  : "A conta está conectada, mas a sincronização precisa ser ativada."}
              </Text>
            )}
            {data.canManage && (
              <Group justify="flex-end">
                {data.connected && (
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconRefresh size={15} />}
                    loading={busy}
                    onClick={() => void action("/api/atendimento/gmail/watch")}
                  >
                    {watchActive ? "Renovar sincronização" : "Ativar sincronização"}
                  </Button>
                )}
                {data.connected ? (
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    leftSection={<IconPlugOff size={15} />}
                    loading={busy}
                    onClick={() =>
                      void action(
                        "/api/atendimento/gmail/disconnect",
                        "Desconectar esta conta Gmail do Fortuno Hub?",
                      )
                    }
                  >
                    Desconectar
                  </Button>
                ) : (
                  <Button
                    size="xs"
                    component="a"
                    href="/api/atendimento/gmail/connect"
                    leftSection={<IconPlugConnected size={15} />}
                    rightSection={<IconExternalLink size={13} />}
                  >
                    Conectar Gmail
                  </Button>
                )}
              </Group>
            )}
          </Stack>
        </Collapse>
      </Paper>
    </Stack>
  );
}
