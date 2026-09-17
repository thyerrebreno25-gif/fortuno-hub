"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Progress,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconCloudUpload,
  IconExternalLink,
  IconLink,
  IconLinkOff,
  IconRefresh,
} from "@tabler/icons-react";
import {
  findContaAzulOption,
  type ContaAzulOption,
  type FinancialDirection,
} from "@/modules/conta-azul/financial-export";
import { beginSessionKeepAlive } from "@/modules/session/client-activity";
import { invalidAccountAllocationLines, summarizeAccountAllocation } from "@/modules/conta-azul/financial-account-allocation";

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
  financialAccountId?: string | null;
  financialAccountName?: string | null;
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
  useLineAccounts?: boolean;
  onSendingChange?: (sending: boolean) => void;
};

type OptionsResponse = {
  categories?: ContaAzulOption[];
  costCenters?: ContaAzulOption[];
  financialAccounts?: ContaAzulOption[];
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
  useLineAccounts = false,
  onSendingChange,
}: Props) {
  const notificationSuffix = useId();
  const sendNotificationId = `conta-azul-financial-${notificationSuffix}`;
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [options, setOptions] = useState<OptionsResponse>({});
  const [technicalContactId, setTechnicalContactId] = useState<string | null>(null);
  const [technicalContactName, setTechnicalContactName] = useState<string | null>(null);
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
        const params = new URLSearchParams({
          clientId: clientId!,
          scope: "financial-export",
        });
        const optionsResponse = await fetch(
          `/api/integrations/conta-azul/options?${params.toString()}`,
          { cache: "no-store" },
        );
        const result = await optionsResponse.json() as OptionsResponse;
        if (!optionsResponse.ok) throw new Error(result.error || "Falha ao carregar os dados do Conta Azul.");
        if (!cancelled) {
          setConnected(true);
          setOptions(result);
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
  }, [clientId, counterpartyHint, module, opened, refreshVersion]);

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
  const invalidAccounts = useLineAccounts ? invalidAccountAllocationLines(effectiveLines, options.financialAccounts || []) : [];
  const allocationSummary = useLineAccounts ? summarizeAccountAllocation(effectiveLines, options.financialAccounts || []) : [];
  const canSend = connected
    && (useLineAccounts ? invalidAccounts.length === 0 : Boolean(financialAccountId && options.financialAccounts?.some((account) => account.value === financialAccountId)))
    && unresolved.categories.length === 0
    && unresolved.costCenters.length === 0
    && lines.length > 0;

  async function send() {
    const selectedAccountId = useLineAccounts ? effectiveLines[0]?.financialAccountId : financialAccountId;
    if (!clientId || !selectedAccountId || !canSend) return;
    const releaseSessionKeepAlive = beginSessionKeepAlive();
    setSending(true);
    onSendingChange?.(true);
    setCounts(emptyCounts);
    setOpened(false);
    notifications.hide(sendNotificationId);
    notifications.show({
      id: sendNotificationId,
      loading: true,
      autoClose: false,
      withCloseButton: false,
      color: "blue",
      title: "Envio ao Conta Azul em andamento",
      message: `${lines.length} lançamento(s) sendo processado(s). Você pode continuar usando o sistema.`,
    });
    try {
      const account = options.financialAccounts?.find((item) => item.value === selectedAccountId);
      let resolvedContactId = technicalContactId;
      let resolvedContactName = technicalContactName;
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
            contactId: resolvedContactId,
            contactName: resolvedContactName,
            counterpartyHint: counterpartyHint || account?.label || null,
            financialAccountId: selectedAccountId,
            financialAccountName: account?.label || null,
            useLineAccounts,
            settle,
            lines: effectiveLines,
          }),
        });
        const responseText = await response.text();
        const result = (() => {
          try {
            return responseText ? JSON.parse(responseText) : {};
          } catch {
            return { error: responseText || `O servidor respondeu com erro ${response.status}.` };
          }
        })();
        if (!response.ok) {
          const details = [
            ...(Array.isArray(result.unresolvedCategories) ? result.unresolvedCategories : []),
            ...(Array.isArray(result.unresolvedCostCenters) ? result.unresolvedCostCenters : []),
          ];
          throw new Error(
            `${result.error || "Não foi possível enviar ao Conta Azul."}${details.length ? ` Não encontrados: ${details.join(", ")}.` : ""}`,
          );
        }
        if (typeof result.contactId === "string") {
          resolvedContactId = result.contactId;
          resolvedContactName = typeof result.contactName === "string" ? result.contactName : null;
          setTechnicalContactId(resolvedContactId);
          setTechnicalContactName(resolvedContactName);
        }
        const nextCounts = result.counts || emptyCounts;
        setCounts(nextCounts);
        notifications.update({
          id: sendNotificationId,
          loading: true,
          autoClose: false,
          withCloseButton: false,
          color: "blue",
          title: "Envio ao Conta Azul em andamento",
          message: `Criados: ${nextCounts.CREATED + nextCounts.SETTLED} de ${lines.length}${settle ? ` • baixados: ${nextCounts.SETTLED}` : ""}. Você pode continuar usando o sistema.`,
        });
        if (result.done) {
          completed = true;
          notifications.update({
            id: sendNotificationId,
            loading: false,
            autoClose: 6000,
            withCloseButton: true,
            color: "green",
            title: "Envio concluído",
            message: result.message,
          });
          try {
            await onSuccess?.();
          } catch {
            // O envio já terminou; uma eventual falha ao atualizar a tela não altera o resultado.
          }
          break;
        }
        if (!result.needsContinue) throw new Error(result.message || "O envio ficou incompleto.");
        await delay(500);
      }
      if (!completed) {
        throw new Error("O Conta Azul ainda está processando os lançamentos. Tente continuar o envio em instantes.");
      }
    } catch (error) {
      notifications.update({
        id: sendNotificationId,
        loading: false,
        autoClose: 10000,
        withCloseButton: true,
        color: "red",
        title: "Envio não concluído",
        message: `${error instanceof Error ? error.message : "Não foi possível enviar ao Conta Azul."} O progresso concluído foi preservado; reabra o envio para continuar.`,
      });
    } finally {
      releaseSessionKeepAlive();
      setSending(false);
      onSendingChange?.(false);
    }
  }

  return (
    <>
      <Button
        variant="light"
        leftSection={<IconCloudUpload size={18} />}
        loading={sending}
        disabled={disabled || !clientId || lines.length === 0 || sending}
        onClick={() => {
          setTechnicalContactId(null);
          setTechnicalContactName(null);
          setFinancialAccountId(null);
          setCategoryOverrides({});
          setOpened(true);
        }}
      >
        {sending
          ? `Enviando ${counts.CREATED + counts.SETTLED}/${lines.length}...`
          : "Enviar direto ao Conta Azul"}
      </Button>

      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Enviar lançamentos ao Conta Azul"
        size="lg"
      >
        <Stack>
          {loading ? (
            <Text c="dimmed">Validando a conexão e carregando os cadastros...</Text>
          ) : !connected ? (
            <Alert color="orange" icon={<IconLinkOff size={18} />} title="Cliente não conectado">
              <Stack gap="sm">
                <Text size="sm">
                  Este cliente ainda não possui um vínculo com o Conta Azul.
                  Autorize a empresa para continuar o envio.
                </Text>
                <Group gap="xs">
                  <Button
                    component="a"
                    href={`/api/integrations/conta-azul/connect?clientId=${encodeURIComponent(clientId!)}&returnTo=connections`}
                    size="xs"
                    leftSection={<IconLink size={14} />}
                  >
                    Vincular agora
                  </Button>
                  <Button
                    component="a"
                    href="/integracoes/conta-azul"
                    size="xs"
                    variant="default"
                  >
                    Gerenciar todos os vínculos
                  </Button>
                </Group>
              </Stack>
            </Alert>
          ) : (
            <>
              <Group justify="space-between">
                <Badge color="green" leftSection={<IconCheck size={12} />}>Conta Azul conectado</Badge>
                <Text size="sm" c="dimmed">{lines.length} lançamento(s) em linhas separadas</Text>
              </Group>

              <Alert
                color="blue"
                title={module === "ACQUIRER"
                  ? "Vínculo automático da adquirente"
                  : "Vínculo automático da fatura"}
              >
                {useLineAccounts ? "Cada lançamento será direcionado para a conta escolhida na fatura, inclusive na baixa. " : "Você escolhe somente a conta financeira. "}Como a API do Conta Azul exige um contato técnico,
                o Fortuno Hub localizará ou criará automaticamente o cadastro “LANÇAMENTO AUTOMÁTICO”
                {" "}para concluir o envio, sem pedir a seleção de um fornecedor.
              </Alert>
              {useLineAccounts ? <Stack gap="xs">
                <Text fw={700}>Rateio por conta financeira</Text>
                <ScrollArea><Table miw={540}>
                  <Table.Thead><Table.Tr><Table.Th>Conta</Table.Th><Table.Th>Itens</Table.Th><Table.Th>Despesas</Table.Th><Table.Th>Créditos</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>{allocationSummary.map((group) => <Table.Tr key={group.accountId}>
                    <Table.Td>{group.accountName}</Table.Td><Table.Td>{group.count}</Table.Td>
                    <Table.Td>{group.payableAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</Table.Td>
                    <Table.Td>{group.receivableAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</Table.Td>
                  </Table.Tr>)}</Table.Tbody>
                </Table></ScrollArea>
                {invalidAccounts.length > 0 && <Alert color="orange">{invalidAccounts.length} lançamento(s) sem conta ativa válida. Volte à fatura e revise o rateio.</Alert>}
              </Stack> : <Select
                label="Conta financeira"
                description="Conta usada nos lançamentos e, quando marcado, também nas baixas."
                data={options.financialAccounts || []}
                value={financialAccountId}
                onChange={setFinancialAccountId}
                searchable
                nothingFoundMessage="Nenhuma conta localizada"
                required
              />}
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
                <Button variant="default" onClick={() => setOpened(false)}>
                  Cancelar
                </Button>
                <Button
                  loading={sending}
                  disabled={!canSend || sending}
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
