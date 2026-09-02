"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Progress,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudUpload,
  IconExternalLink,
  IconLinkOff,
  IconRefresh,
} from "@tabler/icons-react";
import {
  findContaAzulOption,
  type ContaAzulOption,
  type FinancialDirection,
} from "@/modules/conta-azul/financial-export";

export type DirectFinancialLine = {
  lineKey: string;
  direction: FinancialDirection;
  competenceDate: string;
  dueDate: string;
  paymentDate?: string | null;
  description: string;
  amount: number;
  categoryName: string;
  costCenterName?: string | null;
  observation?: string;
  metadata?: Record<string, unknown>;
};

type Props = {
  clientId: string | null;
  module: "CREDIT_CARD_INVOICE" | "ACQUIRER";
  sourceKey: string;
  sourceName: string;
  counterpartyHint?: string | null;
  lines: DirectFinancialLine[];
  disabled?: boolean;
  onSuccess?: () => void | Promise<void>;
};

type OptionsResponse = {
  categories?: ContaAzulOption[];
  costCenters?: ContaAzulOption[];
  financialAccounts?: ContaAzulOption[];
  suppliers?: ContaAzulOption[];
  error?: string;
};

type ProgressCounts = {
  PENDING: number;
  CREATED: number;
  SETTLED: number;
  FAILED: number;
};

const emptyCounts: ProgressCounts = { PENDING: 0, CREATED: 0, SETTLED: 0, FAILED: 0 };

function categoryType(direction: FinancialDirection): ContaAzulOption["type"] {
  return direction === "RECEIVABLE" ? "RECEITA" : "DESPESA";
}

function categoryRequirementKey(direction: FinancialDirection, categoryName: string) {
  return `${direction}:${categoryName}`;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function DirectFinancialSend({
  clientId,
  module,
  sourceKey,
  sourceName,
  counterpartyHint,
  lines,
  disabled,
  onSuccess,
}: Props) {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [options, setOptions] = useState<OptionsResponse>({});
  const [contactId, setContactId] = useState<string | null>(null);
  const [financialAccountId, setFinancialAccountId] = useState<string | null>(null);
  const [settle, setSettle] = useState(true);
  const [counts, setCounts] = useState<ProgressCounts>(emptyCounts);
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    if (!opened || !clientId) return;
    let cancelled = false;
    async function loadContaAzul() {
      setLoading(true);
      setConnected(false);
      setOptions({});
      try {
        const statusResponse = await fetch(
          `/api/integrations/conta-azul/status?clientId=${encodeURIComponent(clientId!)}`,
          { cache: "no-store" },
        );
        const status = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(status?.error || "Falha ao validar a conexão.");
        const active = Boolean(status?.connection?.active && status?.connection?.status === "CONNECTED");
        if (!active) {
          if (!cancelled) setConnected(false);
          return;
        }
        const params = new URLSearchParams({ clientId: clientId! });
        const optionsResponse = await fetch(
          `/api/integrations/conta-azul/options?${params.toString()}`,
          { cache: "no-store" },
        );
        const result = await optionsResponse.json() as OptionsResponse;
        if (!optionsResponse.ok) throw new Error(result.error || "Falha ao carregar os dados do Conta Azul.");
        if (!cancelled) {
          setConnected(true);
          setOptions(result);
          const suggestedContact = counterpartyHint
            ? findContaAzulOption(result.suppliers || [], counterpartyHint)
            : null;
          if (suggestedContact) setContactId(suggestedContact.value);
          else if (result.suppliers?.length === 1) setContactId(result.suppliers[0].value);
        }
      } catch (error) {
        if (!cancelled) {
          setOptions({ error: error instanceof Error ? error.message : "Falha ao consultar o Conta Azul." });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadContaAzul();
    return () => { cancelled = true; };
  }, [clientId, counterpartyHint, opened, refreshVersion]);

  const categoryRequirements = useMemo(() => {
    const categories = options.categories || [];
    const unique = new Map<string, { key: string; name: string; direction: FinancialDirection }>();
    for (const line of lines) {
      if (findContaAzulOption(categories, line.categoryName, categoryType(line.direction))) continue;
      const key = categoryRequirementKey(line.direction, line.categoryName);
      unique.set(key, { key, name: line.categoryName, direction: line.direction });
    }
    return Array.from(unique.values());
  }, [lines, options.categories]);

  const effectiveLines = useMemo(() => {
    const categories = options.categories || [];
    return lines.map((line) => {
      const key = categoryRequirementKey(line.direction, line.categoryName);
      const overrideId = categoryOverrides[key];
      if (!overrideId) return line;
      const replacement = categories.find(
        (option) => option.value === overrideId
          && (!option.type || option.type === categoryType(line.direction)),
      );
      return replacement ? { ...line, categoryName: replacement.label } : line;
    });
  }, [categoryOverrides, lines, options.categories]);

  const unresolved = useMemo(() => {
    const categories = options.categories || [];
    const costCenters = options.costCenters || [];
    return {
      categories: categoryRequirements.filter((requirement) => {
        const overrideId = categoryOverrides[requirement.key];
        return !overrideId || !categories.some(
          (option) => option.value === overrideId
            && (!option.type || option.type === categoryType(requirement.direction)),
        );
      }),
      costCenters: Array.from(new Set(
        effectiveLines.filter(
          (line) => line.costCenterName && !findContaAzulOption(costCenters, line.costCenterName),
        ).map((line) => line.costCenterName as string),
      )),
    };
  }, [categoryOverrides, categoryRequirements, effectiveLines, options.categories, options.costCenters]);

  const progress = lines.length
    ? Math.min(100, ((counts.CREATED + counts.SETTLED) / lines.length) * 100)
    : 0;
  const canSend = connected
    && Boolean(contactId)
    && Boolean(financialAccountId)
    && unresolved.categories.length === 0
    && unresolved.costCenters.length === 0
    && lines.length > 0;

  async function send() {
    if (!clientId || !contactId || !financialAccountId || !canSend) return;
    setSending(true);
    setCounts(emptyCounts);
    try {
      const contact = options.suppliers?.find((item) => item.value === contactId);
      const account = options.financialAccounts?.find((item) => item.value === financialAccountId);
      let completed = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const response = await fetch("/api/integrations/conta-azul/financial-exports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            module,
            sourceKey,
            sourceName,
            contactId,
            contactName: contact?.label || null,
            financialAccountId,
            financialAccountName: account?.label || null,
            settle,
            lines: effectiveLines,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const details = [
            ...(Array.isArray(result.unresolvedCategories) ? result.unresolvedCategories : []),
            ...(Array.isArray(result.unresolvedCostCenters) ? result.unresolvedCostCenters : []),
          ];
          throw new Error(
            `${result.error || "Não foi possível enviar ao Conta Azul."}${details.length ? ` Não encontrados: ${details.join(", ")}.` : ""}`,
          );
        }
        setCounts(result.counts || emptyCounts);
        if (result.done) {
          completed = true;
          notifications.show({
            color: "green",
            title: "Envio concluído",
            message: result.message,
          });
          await onSuccess?.();
          setOpened(false);
          break;
        }
        if (!result.needsContinue) throw new Error(result.message || "O envio ficou incompleto.");
        await delay(500);
      }
      if (!completed) {
        throw new Error("O Conta Azul ainda está processando os lançamentos. Tente continuar o envio em instantes.");
      }
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Envio não concluído",
        message: error instanceof Error ? error.message : "Não foi possível enviar ao Conta Azul.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="light"
        leftSection={<IconCloudUpload size={18} />}
        disabled={disabled || !clientId || lines.length === 0}
        onClick={() => {
          setContactId(null);
          setFinancialAccountId(null);
          setCategoryOverrides({});
          setOpened(true);
        }}
      >
        Enviar direto ao Conta Azul
      </Button>

      <Modal
        opened={opened}
        onClose={() => !sending && setOpened(false)}
        title="Enviar lançamentos ao Conta Azul"
        size="lg"
        closeOnClickOutside={!sending}
        closeOnEscape={!sending}
      >
        <Stack>
          {loading ? (
            <Text c="dimmed">Validando a conexão e carregando os cadastros...</Text>
          ) : !connected ? (
            <Alert color="orange" icon={<IconLinkOff size={18} />} title="Cliente não conectado">
              Vincule este cliente ao Conta Azul na aba Notas de compra antes de continuar.
            </Alert>
          ) : (
            <>
              <Group justify="space-between">
                <Badge color="green" leftSection={<IconCheck size={12} />}>Conta Azul conectado</Badge>
                <Text size="sm" c="dimmed">{lines.length} lançamento(s) em linhas separadas</Text>
              </Group>

              <Select
                label="Cliente/fornecedor no Conta Azul"
                description="Contato que ficará vinculado a cada lançamento."
                data={options.suppliers || []}
                value={contactId}
                onChange={setContactId}
                searchable
                nothingFoundMessage="Nenhum contato localizado"
                required
              />
              <Select
                label="Conta financeira"
                description="Conta usada nos lançamentos e, quando marcado, também nas baixas."
                data={options.financialAccounts || []}
                value={financialAccountId}
                onChange={setFinancialAccountId}
                searchable
                nothingFoundMessage="Nenhuma conta localizada"
                required
              />
              <Checkbox
                checked={settle}
                onChange={(event) => setSettle(event.currentTarget.checked)}
                label="Marcar os lançamentos como liquidados"
                description={settle
                  ? "O Fortuno Hub criará cada lançamento e registrará a baixa na data de pagamento."
                  : "Os lançamentos serão criados em aberto, sem baixa."}
              />

              {(categoryRequirements.length > 0 || unresolved.costCenters.length > 0) && (
                <Alert
                  color={unresolved.categories.length || unresolved.costCenters.length ? "orange" : "blue"}
                  icon={<IconAlertTriangle size={18} />}
                  title="Classificações não localizadas"
                >
                  <Stack gap={4}>
                    {categoryRequirements.map((requirement) => (
                      <Select
                        key={requirement.key}
                        label={`${requirement.name} (${requirement.direction === "RECEIVABLE" ? "receita" : "despesa"})`}
                        description="Selecione uma categoria equivalente já existente no Conta Azul."
                        placeholder="Selecionar categoria existente"
                        data={(options.categories || []).filter(
                          (option) => !option.type || option.type === categoryType(requirement.direction),
                        )}
                        value={categoryOverrides[requirement.key] || null}
                        onChange={(value) => setCategoryOverrides((current) => {
                          const next = { ...current };
                          if (value) next[requirement.key] = value;
                          else delete next[requirement.key];
                          return next;
                        })}
                        searchable
                        clearable
                        nothingFoundMessage="Nenhuma categoria compatível localizada"
                      />
                    ))}
                    {unresolved.costCenters.length > 0 && (
                      <Text size="sm">Centros de custo: {unresolved.costCenters.join(", ")}</Text>
                    )}
                    <Text size="sm">
                      A API do Conta Azul não permite criar categorias. Você pode selecionar uma equivalente acima
                      ou cadastrá-la no Conta Azul e atualizar a lista.
                    </Text>
                    <Group gap="xs">
                      <Button
                        component="a"
                        href="https://app.contaazul.com"
                        target="_blank"
                        rel="noreferrer"
                        variant="default"
                        size="xs"
                        leftSection={<IconExternalLink size={14} />}
                      >
                        Abrir Conta Azul
                      </Button>
                      <Button
                        variant="light"
                        size="xs"
                        loading={loading}
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => setRefreshVersion((current) => current + 1)}
                      >
                        Atualizar categorias
                      </Button>
                    </Group>
                  </Stack>
                </Alert>
              )}

              {sending && (
                <Stack gap={6}>
                  <Progress value={progress} animated />
                  <Text size="sm" c="dimmed">
                    Criados: {counts.CREATED + counts.SETTLED} de {lines.length}
                    {settle ? ` • baixados: ${counts.SETTLED}` : ""}
                  </Text>
                </Stack>
              )}

              <Group justify="flex-end">
                <Button variant="default" disabled={sending} onClick={() => setOpened(false)}>
                  Cancelar
                </Button>
                <Button
                  loading={sending}
                  disabled={!canSend}
                  leftSection={<IconCloudUpload size={18} />}
                  onClick={() => void send()}
                >
                  {settle ? "Criar e liquidar" : "Criar em aberto"}
                </Button>
              </Group>
            </>
          )}
          {options.error && <Alert color="red">{options.error}</Alert>}
        </Stack>
      </Modal>
    </>
  );
}
