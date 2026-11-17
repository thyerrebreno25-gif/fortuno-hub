"use client";
import { useState } from "react";
import { Alert, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconClockEdit } from "@tabler/icons-react";
import { announceOperationTimerChange } from "./timer-client";
import { brazilDateTimeInput, brazilDateTimeIso } from "./time-correction";

type Entry = { id: string; userId: string; startedAt: string; endedAt: string | null; seconds: number; updatedAt: string; source: string; user: { name: string | null; email: string } };
type Props = { activity: { id: string; responsibleId: string | null; timeEntries: Entry[] }; currentUserId: string; canManage: boolean; canEdit: boolean; members: Array<{ id: string; name: string | null; email: string }>; onChanged: () => Promise<void> };
const duration = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min ${seconds % 60}s`;
const stamp = (value: string) => new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

export function TimeCorrectionControl({ activity, currentUserId, canManage, canEdit, members, onChanged }: Props) {
  const [opened, setOpened] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [entryId, setEntryId] = useState("new"), [newEntryId, setNewEntryId] = useState("");
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState("");
  const [start, setStart] = useState(""), [end, setEnd] = useState(""), [reason, setReason] = useState(""), [userId, setUserId] = useState(currentUserId);
  const entries = activity.timeEntries.filter(entry => canManage || entry.userId === currentUserId);
  const canAdd = canManage || activity.responsibleId === currentUserId;
  if (!canEdit || (!canAdd && !entries.length)) return null;
  const entry = entries.find(item => item.id === entryId);
  const choose = (id: string) => {
    const selected = entries.find(item => item.id === id);
    setEntryId(id); setError(""); setReason(""); setUserId(selected?.userId || currentUserId);
    setExpectedUpdatedAt(selected?.updatedAt || "");
    setStart(selected ? brazilDateTimeInput(selected.startedAt) : "");
    setEnd(selected ? brazilDateTimeInput(selected.endedAt || new Date()) : "");
  };
  let seconds: number | null = null;
  if (start && end) {
    const delta = Math.floor((+new Date(`${end}-03:00`) - +new Date(`${start}-03:00`)) / 1000);
    if (Number.isFinite(delta) && delta >= 0) seconds = delta;
  }
  async function save() {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/operations/activities/${activity.id}/time-correction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(entry ? { entryId: entry.id, expectedUpdatedAt } : { newEntryId, userId }), startedAt: brazilDateTimeIso(start), endedAt: brazilDateTimeIso(end), reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a correção.");
      setOpened(false); announceOperationTimerChange();
      notifications.show({ color: "teal", title: "Tempo atualizado", message: "Correção salva no histórico da atividade." });
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a correção."); }
    finally { setSaving(false); }
  }
  return <>
    <Button size="xs" variant="subtle" leftSection={<IconClockEdit size={16} />} onClick={() => { setNewEntryId(crypto.randomUUID()); choose([...entries].reverse().find(item => item.userId === currentUserId)?.id || "new"); setOpened(true); }}>Apontar correção</Button>
    <Modal opened={opened} onClose={() => { if (!saving) setOpened(false); }} title="Apontar correção de tempo" centered size="lg" closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <Stack>
        <Text size="sm" c="dimmed">Adicione um período que esqueceu de apontar ou ajuste os horários de um registro. Horário de Brasília. A justificativa e os valores anteriores ficam no histórico.</Text>
        {error && <Alert color="red">{error}</Alert>}
        <Select label="Apontamento" required disabled={saving} value={entryId} onChange={value => choose(value || "new")} data={[...(canAdd ? [{ value: "new", label: "Adicionar tempo não registrado" }] : []), ...entries.map(item => ({ value: item.id, label: `${item.user.name || item.user.email} · ${stamp(item.startedAt)} · ${item.endedAt ? duration(item.seconds) : "Em andamento"}` }))]} />
        {entry && <Paper withBorder p="sm" radius="md"><Group justify="space-between"><Text size="sm">Registro atual: {entry.endedAt ? duration(entry.seconds) : "Cronômetro em andamento"}</Text><Badge variant="light">{entry.source === "TIMER" ? "Cronômetro" : entry.source === "MANUAL" ? "Manual" : "Corrigido"}</Badge></Group></Paper>}
        {!entry && canManage && <Select label="Colaborador" searchable required disabled={saving} value={userId} onChange={value => setUserId(value || currentUserId)} data={members.map(person => ({ value: person.id, label: person.name || person.email }))} />}
        {entry && !entry.endedAt && <Alert color="blue">Ao salvar, este cronômetro será encerrado no horário de término informado.</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 2 }}><TextInput label="Início" type="datetime-local" step={1} required disabled={saving} value={start} onChange={event => setStart(event.currentTarget.value)} /><TextInput label="Término" type="datetime-local" step={1} required disabled={saving} value={end} onChange={event => setEnd(event.currentTarget.value)} /></SimpleGrid>
        <Text size="sm" fw={600}>Tempo corrigido: {seconds === null ? "Informe horários válidos" : duration(seconds)}</Text>
        <Text size="xs" c="dimmed">Para zerar um registro feito por engano, informe o mesmo início e término.</Text>
        <Textarea label="Justificativa" required minRows={3} maxLength={2000} disabled={saving} value={reason} onChange={event => setReason(event.currentTarget.value)} placeholder="Ex.: esqueci de pausar; concluí a atividade às 14h30." />
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={() => setOpened(false)}>Cancelar</Button><Button loading={saving} disabled={seconds === null || reason.trim().length < 5 || (!entry && !userId)} onClick={() => void save()}>Salvar correção</Button></Group>
      </Stack>
    </Modal>
  </>;
}
