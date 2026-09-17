"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Progress, ScrollArea, Select, Stack, Table, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { CategoryHistoryView } from "./category-history";
import { beginSessionKeepAlive } from "@/modules/session/client-activity";

async function payload(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível consultar o histórico.");
  return result;
}
function endpoint(conversationId: string) { return `/api/assistant/conversations/${conversationId}/category-learning`; }
async function action(conversationId: string, data: unknown, apiEndpoint?: string) {
  return payload(await fetch(apiEndpoint || endpoint(conversationId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }));
}
function notify(error: unknown) {
  notifications.show({ color: "red", title: "Aprendizado não concluído", message: error instanceof Error ? error.message : "Tente novamente." });
}
function previousMonth() {
  const current = new Date();
  const start = new Date(current.getFullYear(), current.getMonth() - 1, 1);
  const end = new Date(current.getFullYear(), current.getMonth(), 0);
  const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}

export function CategoryLearningDialog(props: {
  opened: boolean; onClose: () => void; conversationId: string; clientId: string; clientName: string;
  onRefresh: () => Promise<void>; onBusy: (busy: boolean) => void;
  apiEndpoint?: string;
  onPreview?: (result: { conversationId: string; previewMessageId: string; preview: CategoryHistoryView }) => void;
}) {
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [period, setPeriod] = useState(previousMonth);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!props.opened) return;
    let active = true;
    fetchResponse().then(payload).then((result) => { if (active) setAccounts(result.accounts); })
      .catch((error) => { if (active) notify(error); }).finally(() => { if (active) setLoading(false); });
    function fetchResponse(): Promise<Response> {
      return fetch(`${props.apiEndpoint || endpoint(props.conversationId)}?clientId=${encodeURIComponent(props.clientId)}`, { cache: "no-store" });
    }
    return () => { active = false; };
  }, [props.opened, props.conversationId, props.clientId, props.apiEndpoint]);

  async function preview() {
    if (!accountId || busy) return;
    setBusy(true); props.onBusy(true);
    const release = beginSessionKeepAlive();
    try {
      const result = await action(props.conversationId, { action: "preview", clientId: props.clientId, accountId, ...period }, props.apiEndpoint);
      props.onPreview?.(result);
      await props.onRefresh();
      props.onClose();
    } catch (error) { notify(error); }
    finally { release(); setBusy(false); props.onBusy(false); }
  }
  return <Modal opened={props.opened} onClose={() => { if (!busy) props.onClose(); }} title="Aprender categorias pelo Conta Azul" size="lg" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
    <Stack>
      <Text fw={700}>{props.clientName}</Text>
      <Alert color="blue">Escolha a conta/cartão onde as compras foram lançadas individualmente. O sistema consultará as categorias já utilizadas, sem alterar lançamentos no Conta Azul.</Alert>
      <Select label="Conta/cartão no Conta Azul" placeholder={loading ? "Carregando contas…" : "Selecione a conta do cartão"} searchable
        data={accounts.map((account) => ({ value: account.id, label: account.name }))} value={accountId} onChange={setAccountId} disabled={loading || busy} />
      {!loading && !accounts.length && <Text size="sm" c="orange">Nenhuma conta disponível. Confira a conexão do cliente.</Text>}
      <Group grow>
        <TextInput type="date" label="Vencimento inicial" value={period.start} onChange={(event) => { const value = event.currentTarget.value; setPeriod((current) => ({ ...current, start: value })); }} disabled={busy} />
        <TextInput type="date" label="Vencimento final" value={period.end} onChange={(event) => { const value = event.currentTarget.value; setPeriod((current) => ({ ...current, end: value })); }} disabled={busy} />
      </Group>
      <Text size="xs" c="dimmed">Até 93 dias por consulta. O período considera o vencimento dos lançamentos, não a data da compra.</Text>
      <Group justify="flex-end"><Button variant="default" onClick={props.onClose} disabled={busy}>Cancelar</Button><Button onClick={() => void preview()} loading={busy} disabled={!accountId || loading}>Consultar histórico</Button></Group>
    </Stack>
  </Modal>;
}

export function CategoryLearningPreviewCard(props: {
  conversationId: string; messageId: string; preview: CategoryHistoryView; disabled: boolean;
  onRefresh: () => Promise<void>; onBusy: (busy: boolean) => void;
  apiEndpoint?: string; onConfirmed?: () => Promise<void>;
}) {
  const [preview, setPreview] = useState(props.preview);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Record<string, string>>(() => Object.fromEntries(props.preview.complete
    ? props.preview.candidates.filter((candidate) => candidate.status === "READY").map((candidate) => [candidate.key, candidate.options[0].categoryId]) : []));

  async function finishConsultation() {
    if (busy || props.disabled) return;
    setBusy(true); props.onBusy(true);
    const release = beginSessionKeepAlive();
    try {
      let current = preview;
      while (!current.complete) {
        const result = await action(props.conversationId, { action: "continue", messageId: props.messageId,
          ...(props.apiEndpoint ? { conversationId: props.conversationId, clientId: preview.client.id } : {}),
        }, props.apiEndpoint);
        current = result.preview; setPreview(current);
      }
      setSelection(Object.fromEntries(current.candidates.filter((candidate) => candidate.status === "READY").map((candidate) => [candidate.key, candidate.options[0].categoryId])));
    } catch (error) { notify(error); }
    finally { try { await props.onRefresh(); } catch (error) { notify(error); } finally { release(); setBusy(false); props.onBusy(false); } }
  }
  async function confirm() {
    if (busy || props.disabled) return;
    const selections = Object.entries(selection).filter(([, categoryId]) => categoryId).map(([key, categoryId]) => ({ key, categoryId }));
    if (!selections.length) return;
    setBusy(true); props.onBusy(true);
    const release = beginSessionKeepAlive();
    try {
      const result = await action(props.conversationId, { action: "confirm", messageId: props.messageId, selections,
        ...(props.apiEndpoint ? { conversationId: props.conversationId, clientId: preview.client.id } : {}),
      }, props.apiEndpoint);
      if (result.preview) setPreview(result.preview);
      notifications.show({ color: "green", title: "Aprendizado salvo", message: `${result.savedCount} regra(s) aprendida(s) para as próximas faturas deste cliente.` });
      await props.onRefresh();
      await props.onConfirmed?.();
    } catch (error) { notify(error); }
    finally { release(); setBusy(false); props.onBusy(false); }
  }
  const selectedCount = Object.values(selection).filter(Boolean).length;
  const disabled = busy || props.disabled || !!preview.savedAt;
  return <Stack gap="sm" mt="md">
    <Group gap="xs"><Badge>Histórico Conta Azul</Badge><Badge color={preview.complete ? "green" : "orange"}>{preview.complete ? "Consulta concluída" : "Consulta em etapas"}</Badge></Group>
    <Text size="sm">{preview.processedCount}{preview.total !== null ? ` de ${preview.total}` : ""} lançamento(s) consultado(s).</Text>
    {preview.complete && (preview.skipped > 0 || preview.withoutClassificationCount > 0) && <Text size="xs" c="dimmed">
      {preview.skipped} item(ns) ignorado(s), como faturas consolidadas ou cancelados; {preview.withoutClassificationCount} sem classificação válida no catálogo atual.
    </Text>}
    {!preview.complete && <>
      {preview.total !== null && <Progress value={Math.min(100, preview.processedCount / Math.max(1, preview.total) * 100)} animated={busy} />}
      <Text size="xs" c="dimmed">A consulta continuará em lotes até concluir. Se houver interrupção, você poderá retomar por este cartão.</Text>
      <Button onClick={() => void finishConsultation()} loading={busy} disabled={props.disabled}>Concluir consulta</Button>
    </>}
    {preview.truncated && <Alert color="orange">O histórico atingiu o limite de 5.000 lançamentos. Reduza o período e consulte novamente; esta prévia não poderá ser salva.</Alert>}
    {preview.complete && !preview.candidates.length && <Alert color="orange">Não há descrições com categorias que possam ser aprendidas. Confira a conta e o período. Uma fatura consolidada não permite identificar a categoria de cada compra.</Alert>}
    {preview.complete && preview.candidates.length > 0 && <>
      <Text size="xs" c="dimmed">As regras existentes serão preservadas. Conflitos ficam desmarcados; escolha uma categoria para incluí-los. Centros de custo só serão aprendidos quando consistentes no histórico.</Text>
      <ScrollArea h={Math.min(380, 75 + preview.candidates.length * 80)}>
        <Table miw={560} verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Aprender</Table.Th><Table.Th>Descrição</Table.Th><Table.Th>Categoria / centro de custo</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{preview.candidates.map((candidate) => <Table.Tr key={candidate.key}>
            <Table.Td><Checkbox aria-label={`Aprender ${candidate.description}`} checked={Object.hasOwn(selection, candidate.key)} disabled={disabled || candidate.status === "PRESERVED" || preview.truncated}
              onChange={(event) => { const checked = event.currentTarget.checked; setSelection((current) => {
                const updated = { ...current }; if (checked) updated[candidate.key] = candidate.options.length === 1 ? candidate.options[0].categoryId : ""; else delete updated[candidate.key]; return updated;
              }); }} /></Table.Td>
            <Table.Td><Text size="sm" fw={600}>{candidate.description}</Text><Text size="xs" c="dimmed">{candidate.count} ocorrência(s)</Text>
              {candidate.reason && <Text size="xs" c={candidate.status === "PRESERVED" ? "dimmed" : "orange"}>{candidate.reason}</Text>}</Table.Td>
            <Table.Td>{candidate.status === "CONFLICT" ? <Select aria-label={`Categoria de ${candidate.description}`} placeholder="Escolha a categoria" data={candidate.options.map((option) => ({ value: option.categoryId, label: option.category }))}
              value={selection[candidate.key] || null} disabled={disabled || !Object.hasOwn(selection, candidate.key)}
              onChange={(value) => setSelection((current) => ({ ...current, [candidate.key]: value || "" }))} /> : <Text size="sm">{candidate.options.map((option) => option.category).join(" / ")}</Text>}
              <Text size="xs" c="dimmed">{candidate.options.find((option) => option.categoryId === selection[candidate.key])?.costCenter || "Sem centro de custo aprendido"}</Text></Table.Td>
          </Table.Tr>)}</Table.Tbody>
        </Table>
      </ScrollArea>
      {preview.savedAt ? <Alert color="green">Aprendizado confirmado: {preview.savedCount || 0} regra(s) salva(s).</Alert>
        : <Button onClick={() => void confirm()} loading={busy} disabled={disabled || preview.truncated || !selectedCount || Object.values(selection).some((value) => !value)}>Confirmar aprendizado ({selectedCount})</Button>}
      {preview.savedAt && props.onConfirmed && <Button variant="light" onClick={() => void reapply()} loading={busy} disabled={busy || props.disabled}>Aplicar à fatura aberta</Button>}
    </>}
  </Stack>;

  async function reapply() {
    setBusy(true); props.onBusy(true);
    const release = beginSessionKeepAlive();
    try { await props.onConfirmed?.(); } catch (error) { notify(error); }
    finally { release(); setBusy(false); props.onBusy(false); }
  }
}
