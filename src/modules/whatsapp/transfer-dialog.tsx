"use client";
import { Alert, Button, Group, Modal, Paper, SegmentedControl, Select, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { responsibleForTransfer, type WhatsAppRoutingArea, type WhatsAppRoutingClient } from "./core";
export type TransferClient = WhatsAppRoutingClient & { id: string; name: string; document: string | null };
type Operator = { id: string; name: string | null; email: string; canAttend?: boolean };
const areas = [{ value: "ACCOUNTS_PAYABLE", label: "Contas a pagar" }, { value: "ACCOUNTS_RECEIVABLE", label: "Contas a receber" }, { value: "GENERAL", label: "Atendimento geral" }];
export function WhatsAppTransferDialog({ opened, onClose, onTransfer, clients, operators, clientId, routingArea, saving }: { opened: boolean; onClose: () => void; onTransfer: (data: Record<string, unknown>) => Promise<boolean>; clients: TransferClient[]; operators: Operator[]; clientId: string | null; routingArea: WhatsAppRoutingArea; saving: boolean }) {
  const [mode, setMode] = useState("AREA"), [selectedClient, setSelectedClient] = useState<string | null>(clientId);
  const [area, setArea] = useState<WhatsAppRoutingArea>(routingArea === "UNKNOWN" ? "ACCOUNTS_PAYABLE" : routingArea);
  const [operatorId, setOperatorId] = useState<string | null>(null), [note, setNote] = useState("");
  const client = clients.find((item) => item.id === selectedClient);
  const responsibleId = mode === "AREA" && client ? responsibleForTransfer(client, area) : operatorId;
  const eligible = operators.filter((operator) => operator.canAttend);
  const target = eligible.find((operator) => operator.id === responsibleId);
  const configuredTarget = operators.find((operator) => operator.id === responsibleId);
  return <Modal opened={opened} onClose={onClose} title="Transferir atendimento" centered size="lg" closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}>
    <Stack gap="md">
      <SegmentedControl fullWidth value={mode} onChange={setMode} disabled={saving} data={[{ value: "AREA", label: "Responsável pela área" }, { value: "OPERATOR", label: "Escolher operador" }]} />
      <Select label={mode === "AREA" ? "Cliente" : "Cliente (opcional)"} placeholder="Selecione o cliente deste contato ou grupo" data={clients.map((item) => ({ value: item.id, label: item.name }))} searchable clearable={mode !== "AREA"} value={selectedClient} onChange={setSelectedClient} disabled={saving} description={!clientId ? "O vínculo será lembrado nos próximos atendimentos deste contato ou grupo." : undefined} />
      {mode === "AREA" ? <Select label="Área do atendimento" data={areas} value={area} onChange={(value) => setArea((value || "GENERAL") as WhatsAppRoutingArea)} disabled={saving} /> : <Select label="Operador de destino" placeholder="Selecione o operador" data={eligible.map((item) => ({ value: item.id, label: item.name || item.email }))} searchable value={operatorId} onChange={setOperatorId} disabled={saving} />}
      {target ? <Paper p="md" withBorder radius="md"><Text size="xs" c="dimmed">Destino da transferência</Text><Text fw={750}>{target.name || target.email}</Text>{mode === "AREA" && <Text size="sm" c="dimmed">{client?.name} · {areas.find((item) => item.value === area)?.label}</Text>}</Paper> : mode === "AREA" && selectedClient ? <Alert color="orange">{configuredTarget ? `${configuredTarget.name || configuredTarget.email}, responsável desta área, ainda não possui acesso de atendimento ao WhatsApp. Selecione outro operador ou ajuste as permissões.` : responsibleId ? "O responsável cadastrado para esta área não está disponível na equipe. Confira o cadastro ou selecione outro operador." : "Este cliente ainda não possui responsável cadastrado para esta área. Atualize o cadastro ou escolha um operador."}</Alert> : null}
      <Textarea label="Observação para o operador" placeholder="Ex.: Cliente precisa confirmar um pagamento de hoje." value={note} onChange={(event) => setNote(event.currentTarget.value)} maxLength={1000} minRows={2} disabled={saving} />
      <Text size="sm" c="dimmed">A conversa e o histórico serão mantidos. A transferência ficará registrada como nota interna.</Text>
      <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={saving}>Cancelar</Button><Button color="teal" loading={saving} disabled={!target} onClick={async () => { const success = await onTransfer({ action: "transfer", mode, ...(selectedClient ? { clientId: selectedClient } : {}), ...(mode === "AREA" ? { routingArea: area } : { assignedToId: operatorId }), note }); if (success) onClose(); }}>Confirmar transferência</Button></Group>
    </Stack>
  </Modal>;
}
