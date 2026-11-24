"use client";
import { useState } from "react";
import { Alert, Badge, Button, Group, Modal, ScrollArea, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { announceOperationTimerChange } from "./timer-client";
import { selectedActivityDeletion, type BulkActivityPreview } from "./bulk-delete-model";
type SelectedActivity = BulkActivityPreview & { scheduledDate: string | null };
const labels: Record<string, string> = { OPEN: "Aberta", IN_PROGRESS: "Em andamento", PAUSED: "Pausada", BLOCKED: "Impedida", COMPLETED: "Concluída", DISREGARDED: "Desconsiderada" };
export function SelectedActivityDeleteControl({ activities, onDeleted, onRefresh }: { activities: SelectedActivity[]; onDeleted: (ids: string[]) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [review, setReview] = useState<SelectedActivity[] | null>(null), [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [stale, setStale] = useState(false);
  async function submit() {
    if (!review?.length || busy || stale || reason.trim().length < 5) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/activities/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selectedActivityDeletion(review,reason)) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) setStale(true); throw new Error(body.error || "Não foi possível excluir a seleção."); }
      const ids = review.map(activity => activity.id); setReview(null); announceOperationTimerChange(); await onDeleted(ids);
      notifications.show({ color: "teal", title: "Atividades excluídas", message: `${body.deleted} atividade(s) selecionada(s) retirada(s) da operação.` });
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível excluir a seleção."); }
    finally { setBusy(false); }
  }
  return <><Button size="xs" color="red" variant="light" leftSection={<IconTrash size={15}/>} disabled={!activities.length} onClick={() => { setReview(activities.map(activity => ({ ...activity }))); setReason(""); setError(""); setStale(false); }}>Excluir selecionadas ({activities.length})</Button>
    <Modal opened={Boolean(review)} onClose={() => { if (!busy) setReview(null); }} title="Excluir atividades selecionadas" centered size="lg" closeOnEscape={!busy} closeOnClickOutside={!busy} withCloseButton={!busy}><Stack>
      <Group justify="space-between"><Text size="sm">Confira as atividades que você marcou na lista.</Text><Badge color="red" variant="light">{review?.length || 0} selecionada(s)</Badge></Group>
      <Text size="sm" c="dimmed">Somente estas atividades serão removidas. As rotinas e as atividades que não foram selecionadas permanecem. Cronômetros abertos destas atividades serão encerrados e o histórico da exclusão fica registrado.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <ScrollArea.Autosize mah={320}><Stack gap="xs">{review?.map(activity => <div key={activity.id} style={{ padding: 10, border: "1px solid var(--mantine-color-default-border)", borderRadius: 8 }}><Text size="sm" fw={650}>{activity.client.name}</Text><Text size="sm">{activity.title}</Text><Text size="xs" c="dimmed">{activity.scheduledDate ? activity.scheduledDate.slice(0, 10).split("-").reverse().join("/") : "Sem data programada"} · {activity.responsible?.name || activity.responsible?.email || "Sem responsável"} · {labels[activity.status] || activity.status}</Text></div>)}</Stack></ScrollArea.Autosize>
      <Textarea label="Justificativa da exclusão" required minRows={2} maxLength={2000} disabled={busy || stale} value={reason} onChange={event => setReason(event.currentTarget.value)}/>
      <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setReview(null)}>Cancelar</Button>{stale ? <Button onClick={async () => { setReview(null); await onRefresh(); }}>Atualizar lista para conferir novamente</Button> : <Button color="red" loading={busy} disabled={!review?.length || reason.trim().length < 5} onClick={() => void submit()}>Confirmar exclusão de {review?.length || 0} atividade(s)</Button>}</Group>
    </Stack></Modal>
  </>;
}
