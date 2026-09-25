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
import { allocationCategoryKey, allocationClientId, allocationCostCenterKey, applyAllocationClassifications, invalidDestinationAllocationLines, summarizeDestinationAllocation, type DestinationCatalog } from "@/modules/conta-azul/financial-account-allocation";

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
  destinationClientId?: string | null;
  destinationClientName?: string | null;
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
  destinationClients?: { value: string; label: string }[];
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
  destinationClients,
}: Props) {
  const notificationSuffix = useId();
  const sendNotificationId = `conta-azul-financial-${notificationSuffix}`;
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<string, DestinationCatalog>>({});
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [disconnectedClientId, setDisconnectedClientId] = useState<string | null>(null);
  const [technicalContactId, setTechnicalContactId] = useState<string | null>(null);
  const [technicalContactName, setTechnicalContactName] = useState<string | null>(null);
  const [financialAccountId, setFinancialAccountId] = useState<string | null>(null);
  const [settle, setSettle] = useState(true);
  const [counts, setCounts] = useState<ProgressCounts>(emptyCounts);
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});
  const [costCenterOverrides, setCostCenterOverrides] = useState<Record<string, string>>({});
  const [refreshVersion, setRefreshVersion] = useState(0);
  const targetClientIdsKey = JSON.stringify([...new Set(useLineAccounts ? lines.map((line) => allocationClientId(line, clientId || "")) : [clientId || ""])].sort());
  const clientNamesKey = JSON.stringify(destinationClients || []);
  const options = catalogs[clientId || ""] || {};

  useEffect(() => {
    if (!opened || !clientId) return;
    let cancelled = false;
    async function loadContaAzul() {
      setLoading(true);
      setConnected(false);
      setCatalogs({});
      setOptionsError(null);
      setDisconnectedClientId(null);
      try {
        const targets = JSON.parse(targetClientIdsKey) as string[];
        const names = JSON.parse(clientNamesKey) as { value: string; label: string }[];
        const nextCatalogs: Record<string, DestinationCatalog> = {};
        for (const targetId of [...new Set([clientId!, ...targets])]) {
          if (cancelled) return;
          const targetName = names.find((client) => client.value === targetId)?.label || targetId;
          const statusResponse = await fetch(
            `/api/integrations/conta-azul/status?clientId=${encodeURIComponent(targetId)}`,
            { cache: "no-store" },
          );
          const status = await statusResponse.json();
          if (!statusResponse.ok) throw new Error(`${targetName}: ${status?.error || "Falha ao validar a conexão."}`);
          const active = Boolean(status?.connection?.active && status?.connection?.status === "CONNECTED");
          if (!active) {
            if (!cancelled) { setDisconnectedClientId(targetId); setOptionsError(`O cadastro ${targetName} não está conectado ao Conta Azul.`); }
            return;
          }
          if (!targets.includes(targetId)) continue;
          const params = new URLSearchParams({
            clientId: targetId,
            scope: "financial-export",
          });
          const optionsResponse = await fetch(
            `/api/integrations/conta-azul/options?${params.toString()}`,
            { cache: "no-store" },
          );
          const result = await optionsResponse.json() as OptionsResponse;
          if (!optionsResponse.ok) throw new Error(`${targetName}: ${result.error || "Falha ao carregar os dados do Conta Azul."}`);
          nextCatalogs[targetId] = { clientName: targetName, financialAccounts: result.financialAccounts || [], categories: result.categories || [], costCenters: result.costCenters || [] };
        }
        if (!cancelled) {
          setConnected(true);
          setCatalogs(nextCatalogs);
        }
      } catch (error) {
        if (!cancelled) {
          setOptionsError(error instanceof Error ? error.message : "Falha ao consultar o Conta Azul.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadContaAzul();
    return () => { cancelled = true; };
  }, [clientId, opened, refreshVersion, targetClientIdsKey, clientNamesKey]);

  const categoryRequirements = useMemo(() => {
    const unique = new Map<string, { key: string; name: string; direction: FinancialDirection; clientId: string; clientName: string }>();
    for (const line of lines) {
      const targetId = useLineAccounts ? allocationClientId(line, clientId || "") : clientId || "";
      const categories = catalogs[targetId]?.categories || [];
      if (findContaAzulOption(categories, line.categoryName, categoryType(line.direction))) continue;
      const key = allocationCategoryKey(targetId, line.direction, line.categoryName);
      unique.set(key, { key, name: line.categoryName, direction: line.direction, clientId: targetId, clientName: catalogs[targetId]?.clientName || targetId });
    }
    return Array.from(unique.values());
  }, [lines, catalogs, clientId, useLineAccounts]);

  const costCenterRequirements = useMemo(() => {
    const unique = new Map<string, { key: string; name: string; clientId: string; clientName: string }>();
    for (const line of lines) {
      const targetId = useLineAccounts ? allocationClientId(line, clientId || "") : clientId || "";
      if (!line.costCenterName || findContaAzulOption(catalogs[targetId]?.costCenters || [], line.costCenterName)) continue;
      const key = allocationCostCenterKey(targetId, line.costCenterName);
      unique.set(key, { key, name: line.costCenterName, clientId: targetId, clientName: catalogs[targetId]?.clientName || targetId });
    }
    return [...unique.values()];
  }, [lines, catalogs, clientId, useLineAccounts]);

  const effectiveLines = useMemo(() => applyAllocationClassifications(lines, catalogs, clientId || "", useLineAccounts, categoryOverrides, costCenterOverrides),
    [categoryOverrides, costCenterOverrides, lines, catalogs, clientId, useLineAccounts]);

  const unresolved = useMemo(() => {
    return {
      categories: categoryRequirements.filter((requirement) => {
        const overrideId = categoryOverrides[requirement.key];
        return !overrideId || !catalogs[requirement.clientId]?.categories?.some(
          (option) => option.value === overrideId
            && (!option.type || option.type === categoryType(requirement.direction)),
        );
      }),
      costCenters: costCenterRequirements.filter((requirement) => !catalogs[requirement.clientId]?.costCenters?.some((option) => option.value === costCenterOverrides[requirement.key])),
    };
  }, [categoryOverrides, costCenterOverrides, categoryRequirements, costCenterRequirements, catalogs]);

  const progress = lines.length
    ? Math.min(100, ((counts.CREATED + counts.SETTLED) / lines.length) * 100)
    : 0;
  const invalidAccounts = useLineAccounts ? invalidDestinationAllocationLines(effectiveLines, catalogs, clientId || "") : [];
  const allocationSummary = useLineAccounts ? summarizeDestinationAllocation(effectiveLines, catalogs, clientId || "") : [];
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
      const firstTargetId = useLineAccounts ? allocationClientId(effectiveLines[0], clientId) : clientId;
      const account = catalogs[firstTargetId]?.financialAccounts.find((item) => item.value === selectedAccountId);
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
          setCostCenterOverrides({});
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
                  Um dos cadastros necessários ainda não possui vínculo ou não pôde ser consultado no Conta Azul.
                  Confira a conexão de cada unidade para continuar o envio.
                </Text>
                <Group gap="xs">
                  <Button
                    component="a"
                    href={`/api/integrations/conta-azul/connect?clientId=${encodeURIComponent(disconnectedClientId || clientId!)}&returnTo=connections`}
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
                {useLineAccounts ? "Cada lançamento será direcionado para o cadastro/CNPJ e a conta escolhidos na fatura, inclusive na baixa. " : "Você escolhe somente a conta financeira. "}
                {module === "CREDIT_CARD_INVOICE"
                  ? `O Fortuno Hub usará ${counterpartyHint ? `“${counterpartyHint}”` : "o banco selecionado"} como fornecedor das despesas, localizando ou criando esse cadastro automaticamente no Conta Azul.`
                  : "Como a API do Conta Azul exige um contato técnico, o Fortuno Hub localizará ou criará automaticamente o cadastro “LANÇAMENTO AUTOMÁTICO” para concluir o envio, sem pedir a seleção de um fornecedor."}
              </Alert>
              {useLineAccounts ? <Stack gap="xs">
                <Text fw={700}>Rateio por cadastro e conta</Text>
                <ScrollArea><Table miw={750}>
                  <Table.Thead><Table.Tr><Table.Th>Cadastro de destino</Table.Th><Table.Th>Conta</Table.Th><Table.Th>Itens</Table.Th><Table.Th>Despesas</Table.Th><Table.Th>Créditos</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>{allocationSummary.map((group) => <Table.Tr key={JSON.stringify([group.clientId, group.accountId])}>
                    <Table.Td>{group.clientName}</Table.Td><Table.Td>{group.accountName}</Table.Td><Table.Td>{group.count}</Table.Td>
                    <Table.Td>{group.payableAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</Table.Td>
                    <Table.Td>{group.receivableAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</Table.Td>
                  </Table.Tr>)}</Table.Tbody>
                </Table></ScrollArea>
                {invalidAccounts.length > 0 && <Alert color="orange">{invalidAccounts.length} lançamento(s) sem conta ativa válida no cadastro escolhido. Volte à fatura e revise o rateio.</Alert>}
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

              {(categoryRequirements.length > 0 || costCenterRequirements.length > 0) && (
                <Alert
                  color={unresolved.categories.length || unresolved.costCenters.length ? "orange" : "blue"}
                  icon={<IconAlertTriangle size={18} />}
                  title="Classificações não localizadas"
                >
                  <Stack gap={4}>
                    {categoryRequirements.map((requirement) => (
                      <Select
                        key={requirement.key}
                        label={`${useLineAccounts ? `${requirement.clientName} — ` : ""}${requirement.name} (${requirement.direction === "RECEIVABLE" ? "receita" : "despesa"})`}
                        description="Selecione uma categoria equivalente já existente no Conta Azul."
                        placeholder="Selecionar categoria existente"
                        data={(catalogs[requirement.clientId]?.categories || []).filter(
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
                    {costCenterRequirements.map((requirement) => <Select key={requirement.key}
                      label={`${useLineAccounts ? `${requirement.clientName} — ` : ""}Centro de custo: ${requirement.name}`}
                      description="Selecione um centro de custo existente no cadastro de destino." data={catalogs[requirement.clientId]?.costCenters || []}
                      value={costCenterOverrides[requirement.key] || null} searchable clearable
                      onChange={(value) => setCostCenterOverrides((current) => { const next = { ...current }; if (value) next[requirement.key] = value; else delete next[requirement.key]; return next; })} />)}
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
          {optionsError && <Alert color="red">{optionsError}</Alert>}
        </Stack>
      </Modal>
    </>
  );
}
