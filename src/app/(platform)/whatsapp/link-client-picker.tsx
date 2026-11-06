"use client";
import { Alert, Badge, Button, Group, Loader, Modal, Pagination, Paper, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
type Entry = { id: string; displayName: string; externalId: string; kind: string };
export function WhatsAppLinkClientPicker({ client, onClose, onLinked }: { client: { id: string; name: string }; onClose: () => void; onLinked: (name: string) => void }) {
  const [search, setSearch] = useState(""), [kind, setKind] = useState("ALL"), [page, setPage] = useState(1), [data, setData] = useState<{ entries: Entry[]; total: number; accountLastDigits?: string } | null>(null), [loading, setLoading] = useState(true), [savingId, setSavingId] = useState<string | null>(null), [error, setError] = useState("");
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
  async function link(entry: Entry) {
    if (savingId) return; setSavingId(entry.id); setError("");
    try {
      const response = await fetch("/api/whatsapp/client-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, entryId: entry.id }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível salvar o vínculo.");
      onLinked(entry.displayName);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível salvar o vínculo."); }
    finally { setSavingId(null); }
  }
  return <Modal opened onClose={() => { if (!savingId) onClose(); }} title={`Vincular contato ou grupo · ${client.name}`} size="lg" centered closeOnClickOutside={!savingId} closeOnEscape={!savingId}>
    <Stack gap="sm">
      <Text size="sm" c="dimmed">Selecione na agenda do WhatsApp conectado{data?.accountLastDigits ? `, final ${data.accountLastDigits}` : ""}. Os vínculos anteriores serão preservados.</Text>
      {error && <Alert color="red">{error}</Alert>}
      <SegmentedControl value={kind} onChange={value => { setKind(value); setPage(1); }} data={[{ value: "ALL", label: "Todos" }, { value: "CONTACT", label: "Contatos" }, { value: "GROUP", label: "Grupos" }]}/>
      <TextInput aria-label="Buscar contato ou grupo para vincular" placeholder="Buscar por nome ou número" value={search} onChange={event => { setSearch(event.currentTarget.value); setPage(1); }} maxLength={150}/>
      {loading && <Group gap="xs"><Loader size="xs"/><Text size="sm" c="dimmed">Consultando a agenda…</Text></Group>}
      <div style={{ maxHeight: "50dvh", overflowY: "auto" }}><Stack gap="xs">{data?.entries.map(entry => <Paper key={entry.id} withBorder radius="md" p="sm"><Group justify="space-between" wrap="nowrap"><div style={{ minWidth: 0 }}><Text fw={650} size="sm" style={{ overflowWrap: "anywhere" }}>{entry.displayName}</Text><Group gap="xs" mt={4}><Badge variant="light" color={entry.kind === "GROUP" ? "violet" : "teal"}>{entry.kind === "GROUP" ? "Grupo" : "Contato"}</Badge><Text size="xs" c="dimmed">{entry.externalId}</Text></Group></div><Button size="compact-sm" aria-label={`Vincular ${entry.displayName}`} loading={savingId === entry.id} disabled={loading || Boolean(savingId && savingId !== entry.id)} onClick={() => void link(entry)}>Vincular</Button></Group></Paper>)}</Stack>{!loading && !data?.entries.length && <Text c="dimmed" ta="center" py="lg">Nenhum contato ou grupo encontrado na agenda atual.</Text>}</div>
      {data && data.total > 100 && <Pagination value={page} onChange={setPage} total={Math.ceil(data.total / 100)}/>}<Text size="xs" c="dimmed">{data?.total || 0} contatos e grupos encontrados</Text>
    </Stack>
  </Modal>;
}
