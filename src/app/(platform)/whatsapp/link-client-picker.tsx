"use client";
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Pagination, Paper, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
type Entry = { id: string; displayName: string; externalId: string; kind: string };
export function WhatsAppLinkClientPicker({ client, onClose, onLinked }: { client: { id: string; name: string }; onClose: () => void; onLinked: (count: number) => void }) {
  const [search, setSearch] = useState(""), [kind, setKind] = useState("ALL"), [page, setPage] = useState(1), [data, setData] = useState<{ entries: Entry[]; total: number; accountLastDigits?: string } | null>(null), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [selected, setSelected] = useState(new Map<string, Entry>());
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/whatsapp/directory?" + new URLSearchParams({ search, kind, page: String(page) }), { cache: "no-store", signal: controller.signal });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível carregar a agenda.");
        if (!controller.signal.aborted) { setData(body); setError(""); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar a agenda."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, kind, page]);
  const entries = data?.entries || [], allSelected = entries.length > 0 && entries.every(entry => selected.has(entry.id)), someSelected = entries.some(entry => selected.has(entry.id));
  function toggle(entry: Entry, checked: boolean) {
    setSelected(current => { const next = new Map(current); if (!checked) next.delete(entry.id); else if (next.size < 100) next.set(entry.id, entry); return next; });
  }
  async function link() {
    if (saving || !selected.size) return; setSaving(true); setError("");
    try {
      const response = await fetch("/api/whatsapp/client-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, entryIds: [...selected.keys()] }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível salvar os vínculos.");
      onLinked(body.count);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar os vínculos."); }
    finally { setSaving(false); }
  }
  return <Modal opened onClose={() => { if (!saving) onClose(); }} title={"Vincular contatos e grupos · " + client.name} size="lg" centered closeOnClickOutside={!saving} closeOnEscape={!saving}>
    <Stack gap="sm">
      <Text size="sm" c="dimmed">Marque os contatos e grupos que deseja vincular. A seleção permanece ao buscar, trocar o filtro ou mudar de página.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <SegmentedControl disabled={saving} value={kind} onChange={value => { setKind(value); setPage(1); }} data={[{ value: "ALL", label: "Todos" }, { value: "CONTACT", label: "Contatos" }, { value: "GROUP", label: "Grupos" }]}/>
      <TextInput disabled={saving} aria-label="Buscar contato ou grupo para vincular" placeholder="Buscar por nome ou número" value={search} onChange={event => { setSearch(event.currentTarget.value); setPage(1); }} maxLength={150}/>
      {loading && <Group gap="xs"><Loader size="xs"/><Text size="sm" c="dimmed">Consultando a agenda…</Text></Group>}
      <Checkbox label="Selecionar resultados desta página" checked={allSelected} indeterminate={someSelected && !allSelected} disabled={loading || saving || !entries.length} onChange={event => { const checked = event.currentTarget.checked; setSelected(current => { const next = new Map(current); for (const entry of entries) { if (!checked) next.delete(entry.id); else if (next.size < 100) next.set(entry.id, entry); } return next; }); }}/>
      <div style={{ maxHeight: "40dvh", overflowY: "auto" }}><Stack gap="xs">{entries.map(entry => <Paper key={entry.id} withBorder radius="md" p="sm" bg={selected.has(entry.id) ? "var(--mantine-color-blue-light)" : undefined}><Checkbox aria-label={"Selecionar " + entry.displayName} checked={selected.has(entry.id)} disabled={saving || loading || !selected.has(entry.id) && selected.size >= 100} onChange={event => toggle(entry, event.currentTarget.checked)} label={<div><Text fw={650} size="sm" style={{ overflowWrap: "anywhere" }}>{entry.displayName}</Text><Group gap="xs" mt={4}><Badge variant="light" color={entry.kind === "GROUP" ? "violet" : "teal"}>{entry.kind === "GROUP" ? "Grupo" : "Contato"}</Badge><Text size="xs" c="dimmed">{entry.externalId}</Text></Group></div>}/></Paper>)}</Stack>{!loading && !entries.length && <Text c="dimmed" ta="center" py="lg">Nenhum contato ou grupo encontrado na agenda atual.</Text>}</div>
      {data && data.total > 100 && <Pagination disabled={saving} value={page} onChange={setPage} total={Math.ceil(data.total / 100)}/>}
      <Group justify="space-between"><Text size="xs" c="dimmed">{data?.total || 0} resultados · até 100 por lote</Text>{selected.size > 0 && <Button size="compact-xs" variant="subtle" disabled={saving} onClick={() => setSelected(new Map())}>Limpar seleção</Button>}</Group>
      <Group justify="space-between" style={{ position: "sticky", bottom: 0, background: "var(--fortuno-surface)", paddingTop: 8 }}><Text fw={650} size="sm">{selected.size} selecionado(s)</Text><Group gap="xs"><Button variant="default" disabled={saving} onClick={onClose}>Cancelar</Button><Button loading={saving} disabled={!selected.size} onClick={() => void link()}>{"Vincular selecionados (" + selected.size + ")"}</Button></Group></Group>
    </Stack>
  </Modal>;
}
