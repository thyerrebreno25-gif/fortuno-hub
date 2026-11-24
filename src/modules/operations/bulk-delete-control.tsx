"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, ScrollArea, Stack, Switch, Text, Textarea, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { announceOperationTimerChange } from "./timer-client";
import type { BulkActivityPreview } from "./bulk-delete-model";
const statuses: Record<string, string> = { OPEN: "Aberta", IN_PROGRESS: "Em andamento", PAUSED: "Pausadas", BLOCKED: "Impedida", COMPLETED: "Concluída", DISREGARDED: "Desconsiderada" };
export function BulkActivityDeleteControl({ initialDay, onChanged }: { initialDay: string; onChanged: () => Promise<void> }) {
  const [opened, setOpened] = useState(false), [day, setDay] = useState(initialDay), [previewDay, setPreviewDay] = useState("");
  const [duplicatesOnly,setDuplicatesOnly]=useState(false);
  const [rows, setRows] = useState<BulkActivityPreview[]>([]), [ids, setIds] = useState<string[]>([]);
  const [search, setSearch] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState("");
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!opened) return;
    const controller = new AbortController(); let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true); setError(""); setIds([]); setRows([]); setPreviewDay("");
      try {
        if (!day) return;
        const response = await fetch(`/api/operations/activities/bulk-delete?day=${encodeURIComponent(day)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível consultar as atividades.");
        if (active) { setRows(body.activities); setPreviewDay(body.day); }
      } catch (cause) { if (active && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Não foi possível consultar as atividades."); }
      finally { if (active) setLoading(false); }
    });
    return () => { active = false; controller.abort(); };
  }, [opened, day]);
  const visible = rows.filter(row => (!duplicatesOnly||Number(row.duplicateCount)>1)&&`${row.title} ${row.client.name} ${row.responsible?.name || row.responsible?.email || ""}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const selected = new Set(ids), all = visible.length > 0 && visible.every(row => selected.has(row.id));
  async function submit() {
    if (saving || loading || previewDay !== day || !ids.length) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/operations/activities/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ day, reason, activities: rows.filter(row => selected.has(row.id)).map(row => ({ id: row.id, updatedAt: row.updatedAt })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível excluir as atividades.");
      setOpened(false); announceOperationTimerChange(); await onChanged();
      notifications.show({ color: "teal", title: "Atividades excluídas", message: `${body.deleted} atividade(s) de ${day.split("-").reverse().join("/")} retirada(s) da operação.` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir as atividades."); }
    finally { setSaving(false); }
  }
  return <><Button variant="subtle" color="gray" size="xs" leftSection={<IconTrash size={15} />} onClick={() => { setDay(initialDay); setRows([]); setIds([]); setPreviewDay(""); setSearch(""); setDuplicatesOnly(false); setReason(""); setError(""); setOpened(true); }}>Selecionar por dia</Button>
    <Modal opened={opened} onClose={() => { if (!saving) setOpened(false); }} title="Selecionar atividades por dia" size="lg" centered closeOnClickOutside={!saving} closeOnEscape={!saving}>
      <Stack>
        <TextInput label="Dia das atividades" type="date" required disabled={saving} value={day} onChange={event => setDay(event.currentTarget.value)} />
        <Text size="sm" c="dimmed">Selecione as atividades desse dia. As rotinas e as atividades dos outros dias serão mantidas. O histórico da exclusão fica registrado.</Text>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput label="Buscar na lista" placeholder="Cliente, atividade ou colaborador" disabled={loading || saving} value={search} onChange={event => setSearch(event.currentTarget.value)} />
        <Switch label="Mostrar somente possíveis duplicadas deste dia" checked={duplicatesOnly} disabled={loading||saving} onChange={event=>{setDuplicatesOnly(event.currentTarget.checked);setIds([]);}}/>
        {duplicatesOnly&&<Alert color="yellow">Mesmo cliente, processo e nome da atividade no mesmo dia. Selecione somente as cópias que deseja remover; confira os responsáveis e mantenha a atividade correta.</Alert>}
        {loading ? <Group justify="center"><Loader size="sm" /><Text size="sm">Carregando atividades…</Text></Group> : <>
          <Group justify="space-between"><Checkbox label={`Selecionar todas as exibidas (${visible.length})`} checked={all} indeterminate={!all && visible.some(row => selected.has(row.id))} disabled={saving || !visible.length || previewDay !== day} onChange={event => setIds(event.currentTarget.checked ? [...new Set([...ids, ...visible.map(row => row.id)])] : ids.filter(id => !visible.some(row => row.id === id)))} /><Badge variant="light" color="red">{ids.length} selecionada(s)</Badge></Group>
          {ids.length > 0 && <Group justify="space-between"><Text size="xs" c="dimmed">{ids.filter(id => !visible.some(row => row.id === id)).length} selecionada(s) fora da busca.</Text><Button size="compact-xs" variant="subtle" disabled={saving} onClick={() => setIds([])}>Limpar seleção</Button></Group>}
          <ScrollArea.Autosize mah={300} type="auto"><Stack gap="xs">{visible.map(row => <Checkbox.Card key={row.id} checked={selected.has(row.id)} onClick={() => { if (!saving) setIds(selected.has(row.id) ? ids.filter(id => id !== row.id) : [...ids, row.id]); }} p="sm" radius="md"><Group wrap="nowrap" align="flex-start"><Checkbox.Indicator disabled={saving} /><div><Text size="sm" fw={600}>{row.client.name}</Text><Text size="sm">{row.title}</Text>{Number(row.duplicateCount)>1&&<Badge size="xs" color="orange" variant="light">{row.duplicateCount} possíveis cópias neste dia</Badge>}<Text size="xs" c="dimmed">{row.responsible?.name || row.responsible?.email || "Sem responsável"} · {statuses[row.status] || row.status}</Text></div></Group></Checkbox.Card>)}{!visible.length && <Text size="sm" c="dimmed" ta="center" p="md">Nenhuma atividade para essa data e busca.</Text>}</Stack></ScrollArea.Autosize>
        </>}
        <Textarea label="Justificativa da exclusão" required minRows={2} maxLength={2000} disabled={saving} value={reason} onChange={event => setReason(event.currentTarget.value)} />
        <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={() => setOpened(false)}>Cancelar</Button><Button color="red" loading={saving} disabled={loading || previewDay !== day || !ids.length || reason.trim().length < 5} onClick={() => void submit()}>Excluir {ids.length} atividade(s)</Button></Group>
      </Stack>
    </Modal></>;
}
