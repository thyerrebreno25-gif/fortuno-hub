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
    try {
      const response = await fetch("/api/atendimento/gmail/status", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Erro ao consultar Gmail.");
      }
      setData(payload);
      if (!payload.connected || payload.sync?.lastError) setExpanded(true);
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
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => window.clearInterval(timer);
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
  if (!data) return <Alert color="orange" title="Não foi possível verificar o Gmail">{error || "Tente novamente."}<Button variant="subtle" size="xs" onClick={() => void load()}>Consultar conexão</Button></Alert>;

  const watchActive =
    data.connection?.watchExpiresAt &&
    new Date(data.connection.watchExpiresAt).getTime() > Date.now();

  return (
    <Stack gap="xs">
      {data?.sync?.lastError && <Alert color="orange" title="Recebimento precisa de atenção">{data.sync.lastError}</Alert>}
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
                {data.connected && <Badge color="blue" variant="light">Consulta automática · 5 min</Badge>}
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
            {data.recovering && <Text size="sm" c="blue">Recuperando os e-mails dos últimos 30 dias em lotes. Os chamados aparecem conforme cada lote termina.</Text>}
            {data.connection?.lastSyncAt && (
              <Text size="xs" c="dimmed">
                Última sincronização: {new Date(data.connection.lastSyncAt).toLocaleString("pt-BR")}
              </Text>
            )}
            {data.connected && (
              <Text size="xs" c="dimmed">
                {watchActive
                  ? "Notificações do Gmail ativas, com consulta de segurança a cada 5 minutos."
                  : "A Caixa de entrada é consultada automaticamente a cada 5 minutos, mesmo sem notificações do Google. Na primeira consulta, recuperamos os últimos 30 dias."}
              </Text>
            )}
            {data.canManage && data.sync?.lastError && <Button component="a" href="/api/atendimento/gmail/connect" size="xs">Reconectar Gmail</Button>}
            {data.canManage && (
              <Group justify="flex-end">
                {data.connected && (
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconRefresh size={15} />}
                    loading={busy}
                    onClick={() => void action("/api/atendimento/gmail/sync?force=1")}
                  >
                    Consultar e-mails agora
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
