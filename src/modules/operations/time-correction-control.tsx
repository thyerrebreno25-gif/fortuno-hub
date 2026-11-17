"use client";
import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconClockEdit } from "@tabler/icons-react";
import { announceOperationTimerChange } from "./timer-client";
import { durationLabel, parseActivityDuration } from "./duration-correction";

type Entry = { id: string; userId: string; startedAt: string; endedAt: string | null; seconds: number; updatedAt: string; user: { name: string | null; email: string } };
type Props = { activity: { id: string; responsibleId: string | null; timeEntries: Entry[] }; currentUserId: string; canManage: boolean; canEdit: boolean; members: Array<{ id: string; name: string | null; email: string }>; onChanged: () => Promise<void> };
type Snapshot = { requestId: string; userId: string; name: string; seconds: number; running: boolean; entries: Array<{ id: string; updatedAt: string }> };

export function TimeCorrectionControl({ activity, currentUserId, canManage, canEdit, members, onChanged }: Props) {
  const [opened, setOpened] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [value, setValue] = useState(""), [reason, setReason] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const authors = [...new Set(activity.timeEntries.map(entry => entry.userId))];
  const userId = canManage ? activity.responsibleId || (authors.length === 1 ? authors[0] : currentUserId) : currentUserId;
  const entries = activity.timeEntries.filter(entry => entry.userId === userId);
  if (!canEdit || (!canManage && activity.responsibleId !== currentUserId && !entries.length)) return null;
  const seconds = parseActivityDuration(value);
  function open() {
    const person = members.find(member => member.id === userId) || entries[0]?.user;
    setSnapshot({ requestId: crypto.randomUUID(), userId, name: person?.name || person?.email || "Seu tempo", seconds: entries.reduce((sum, entry) => sum + (entry.endedAt ? entry.seconds : Math.max(0, Math.floor((Date.now() - Date.parse(entry.startedAt)) / 1000))), 0), running: entries.some(entry => !entry.endedAt), entries: entries.map(entry => ({ id: entry.id, updatedAt: entry.updatedAt })) });
    setValue(""); setReason(""); setError(""); setOpened(true);
  }
  async function save() {
    if (saving || !snapshot || seconds === null) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/operations/activities/${activity.id}/time-correction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "duration", requestId: snapshot.requestId, userId: snapshot.userId, expectedEntries: snapshot.entries, seconds, reason }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a correção.");
      setOpened(false); announceOperationTimerChange();
      notifications.show({ color: "teal", title: "Tempo atualizado", message: "Duração corrigida e justificativa salva no histórico." });
      await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a correção."); }
    finally { setSaving(false); }
  }
  return <>
    <Button size="xs" variant="subtle" leftSection={<IconClockEdit size={16} />} onClick={open}>Apontar correção</Button>
    <Modal opened={opened} onClose={() => { if (!saving) setOpened(false); }} title="Apontar correção" centered size="sm" closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <Stack>
        <Text size="sm" c="dimmed">{snapshot?.name} · Tempo registrado: {durationLabel(snapshot?.seconds || 0)}{snapshot?.seconds ? `:${String(snapshot.seconds % 60).padStart(2, "0")}` : ""}</Text>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label="Duração total (horas:minutos)" description="00:45 = 45 minutos · 02:38 = 2 horas e 38 minutos" placeholder="00:45" required autoFocus disabled={saving} value={value} maxLength={8} onChange={event => setValue(event.currentTarget.value)} onBlur={() => { const parsed = parseActivityDuration(value); if (parsed !== null) setValue(durationLabel(parsed)); }} error={value && seconds === null ? "Use horas:minutos, como 00:45 ou 02:38." : undefined} />
        <Text size="xs" c="dimmed">Informe o tempo total dedicado à atividade. Esse valor substitui o tempo registrado{snapshot?.running ? " e pausa o cronômetro" : ""}.</Text>
        <Textarea label="Justificativa" required minRows={3} maxLength={2000} disabled={saving} value={reason} onChange={event => setReason(event.currentTarget.value)} placeholder="Ex.: esqueci de iniciar ou pausar o cronômetro." />
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={() => setOpened(false)}>Cancelar</Button><Button loading={saving} disabled={seconds === null || reason.trim().length < 5 || (!snapshot?.entries.length && seconds === 0)} onClick={() => void save()}>Salvar correção</Button></Group>
      </Stack>
    </Modal>
  </>;
}
