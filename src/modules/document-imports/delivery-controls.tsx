"use client";
import { useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Stack, Table, Text } from "@mantine/core";
import { type InvestmentReview, type Option, money } from "./model";
export type DeliveryState = { id: string; rowKey: string; status: string; saleNumber: number | null; saleId: string | null; settlementId: string | null; lastError: string | null };
export type DeliveryDraft = { id: string; version: number; status: string; deliveries?: DeliveryState[] };
const labels: Record<string, string> = { PENDING: "Aguardando envio", CREATING: "Verificar criação", UNCERTAIN_SALE: "Criação não confirmada", SALE_CREATED: "Venda criada · baixa pendente", SETTLING: "Verificar baixa", UNCERTAIN_SETTLEMENT: "Baixa não confirmada", SENT: "Venda criada e recebida", FAILED: "CA rejeitou a criação" };
export function DeliveryControls({ draft, review, companyName, clientId, accounts, customers, services, canSend, busy, dirty, onBusy, onResult }: {
  draft: DeliveryDraft; review: InvestmentReview; companyName: string; clientId: string; accounts: Option[]; customers: Option[]; services: Option[];
  canSend: boolean; busy: boolean; dirty: boolean; onBusy: (value: boolean) => void; onResult: (draft: unknown, message: string, error: string) => void;
}) {
  const [opened, setOpened] = useState(false), [confirmed, setConfirmed] = useState(false);
  const deliveries = draft.deliveries || [];
  const completed = deliveries.length === review.rows.length && deliveries.length > 0 && deliveries.every((item) => item.status === "SENT");
  async function send() {
    if (!confirmed) return;
    setOpened(false); onBusy(true);
    let error = ""; let updated: unknown = null; let message = "";
    try {
      const response = await fetch(`/api/document-imports/${draft.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: draft.version, confirmation: "ENVIAR AO CA" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "O envio não foi concluído.");
      updated = body.draft; message = body.completed ? "Vendas criadas e recebidas nas contas selecionadas no CA." : "Envio parcial. Confira o andamento antes de retomar; as vendas já criadas serão preservadas.";
    } catch (cause) { error = cause instanceof Error ? cause.message : "Não foi possível concluir o envio.";
      try { const response = await fetch(`/api/document-imports?kind=INVESTMENT&clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }); if (response.ok) { const body = await response.json(); updated = body.drafts.find((item: DeliveryDraft) => item.id === draft.id); } } catch { /* Existing data remains visible if the status refresh also fails. */ }
    } finally { onResult(updated, message, error); onBusy(false); }
  }
  return <Stack gap="xs">
    <Group><Button color="green" disabled={!canSend || busy || dirty || completed} loading={busy} onClick={() => { setConfirmed(false); setOpened(true); }}>{completed ? "Enviado ao CA" : deliveries.length ? "Verificar / retomar envio" : "Enviar ao CA"}</Button>{dirty && <Text size="xs" c="dimmed">Salve a revisão antes de enviar.</Text>}</Group>
    {deliveries.length > 0 && <Alert color={completed ? "green" : "orange"} title={completed ? "Envio concluído" : "Andamento do envio"}>
      {deliveries.map((item) => <Stack gap={2} key={item.id} mb="xs"><Group gap="xs"><Text size="sm" fw={600}>{review.rows.find((row) => row.key === item.rowKey)?.description || "Rendimento"}</Text><Badge color={item.status === "SENT" ? "green" : "orange"}>{labels[item.status] || item.status}</Badge>{item.saleNumber && <Text size="xs">Venda {item.saleNumber}</Text>}</Group>{item.lastError && <Text size="xs">{item.lastError}</Text>}</Stack>)}
      {!completed && <Text size="xs">Se uma resposta do CA estiver incerta, o sistema consultará o resultado antes de continuar. Não criará outra venda ou baixa automaticamente.</Text>}
    </Alert>}
    <Modal opened={opened} onClose={() => !busy && setOpened(false)} title={deliveries.length ? "Confirmar retomada do envio" : "Confirmar envio real ao Conta Azul"} size="xl"><Stack>
      <Text fw={700}>{companyName}</Text><Text size="sm">Cliente no CA: {customers.find((item) => item.value === review.customerId)?.label || "Não selecionado"}</Text><Text size="sm">Serviço: {services.find((item) => item.value === review.serviceId)?.label || "Não selecionado"}</Text>
      <Table withTableBorder><Table.Thead><Table.Tr><Table.Th>Venda</Table.Th><Table.Th>Valor</Table.Th><Table.Th>Conta de recebimento</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{review.rows.map((row) => <Table.Tr key={row.key}><Table.Td>{row.description}</Table.Td><Table.Td>{money(row.amountCents)}</Table.Td><Table.Td>{accounts.find((item) => item.value === row.accountId)?.label || "Não selecionada"}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
      <Text fw={700}>Total: {money(review.rows.reduce((sum, row) => sum + row.amountCents, 0))}</Text>
      <Text size="sm">Serão criadas vendas aprovadas e registradas as baixas nas contas selecionadas, nas datas dos rendimentos. Etapas já concluídas serão preservadas.</Text>
      <Checkbox label="Conferi a empresa, os valores e as contas e confirmo o envio real ao CA." checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
      <Group justify="flex-end"><Button variant="default" onClick={() => setOpened(false)}>Cancelar</Button><Button color="green" disabled={!confirmed} loading={busy} onClick={() => void send()}>Confirmar envio ao CA</Button></Group>
    </Stack></Modal>
  </Stack>;
}
