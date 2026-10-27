"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Modal, ScrollArea, Select, Stack, Switch, Table, Text, Textarea } from "@mantine/core";
type Result = { clientId: string; client: string; updated: boolean; issues: string[] };
type Payload = { sources?: Array<{ id: string; name: string }>; running: boolean; connection: { clientSourceId: string | null; clientSyncEnabled: boolean; clientSyncAt: string | null; clientSyncConfig: { aliases?: Record<string, string> } | null; clientSyncReport: { total?: number; matched?: number; updated?: number; pending?: number; routing?: { checked?: number; changed?: number; error?: string }; results?: Result[]; error?: string } | null } | null };
export function NotionClientSyncControl({ onSynced }: { onSynced?: () => void } = {}) {
  const [opened, setOpened] = useState(false), [data, setData] = useState<Payload | null>(null), [source, setSource] = useState<string | null>(null), [aliases, setAliases] = useState(""), [enabled, setEnabled] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const lastSync = useRef<string | null>(null);
  const synced = useRef(onSynced);
  useEffect(() => { synced.current = onSynced; }, [onSynced]);
  const load = useCallback(async (initial = false) => {
    const response = await fetch(`/api/integrations/notion/clients${initial ? "?sources=1" : ""}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error);
    if (!initial && body.connection?.clientSyncAt && body.connection.clientSyncAt !== lastSync.current) synced.current?.();
    lastSync.current = body.connection?.clientSyncAt || null;
    setData((old) => ({ ...body, sources: body.sources || old?.sources }));
    if (initial) { setSource(body.connection?.clientSourceId || (body.sources?.length === 1 ? body.sources[0].id : null)); setEnabled(body.connection?.clientSourceId ? body.connection.clientSyncEnabled : true); setAliases(Object.entries(body.connection?.clientSyncConfig?.aliases || {}).map(([label, person]) => `${label}=${person}`).join("\n")); }
  }, []);
  useEffect(() => {
    if (!opened) return;
    const timer = window.setInterval(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Falha na consulta.")); }, 4000);
    return () => window.clearInterval(timer);
  }, [opened, load]);
  async function open() { setOpened(true); setBusy(true); setError(""); try { await load(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha na consulta."); } finally { setBusy(false); } }
  async function sync() {
    if (!source) return;
    setBusy(true); setError("");
    try {
      const entries = aliases.split("\n").filter((line) => line.trim()).map((line) => { const at = line.indexOf("="); if (at < 1 || !line.slice(at + 1).trim()) throw new Error("Use Apelido=Nome completo em cada linha."); return [line.slice(0, at).trim(), line.slice(at + 1).trim()]; });
      const response = await fetch("/api/integrations/notion/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: source, enabled, aliases: Object.fromEntries(entries) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao sincronizar."); } finally { setBusy(false); }
  }
  const report = data?.connection?.clientSyncReport;
  return <><Button variant="light" onClick={() => void open()}>Responsáveis do Notion</Button><Modal opened={opened} onClose={() => setOpened(false)} title="Responsáveis por cliente · Notion" size="xl"><Stack>
    {error && <Alert color="red">{error}</Alert>}{report?.error && <Alert color="orange">{report.error}</Alert>}{report?.routing?.error && <Alert color="orange">{report.routing.error}</Alert>}
    <Select label="Base de clientes do Notion" placeholder="Selecione a base" data={(data?.sources || []).map((s) => ({ value: s.id, label: s.name }))} value={source} onChange={setSource} disabled={busy || data?.running} />
    <Textarea label="Apelidos confirmados" description="Uma correspondência por linha: Apelido=Nome completo do colaborador" value={aliases} onChange={(event) => setAliases(event.currentTarget.value)} minRows={2} disabled={busy || data?.running} />
    <Group justify="space-between"><Switch label="Atualização automática a cada 15 minutos" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} disabled={data?.running} /><Button onClick={() => void sync()} disabled={!source} loading={busy || data?.running}>{data?.running ? "Sincronizando…" : "Salvar e sincronizar"}</Button></Group>
    {data?.connection?.clientSyncAt && <Text size="xs" c="dimmed">Última consulta: {new Date(data.connection.clientSyncAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</Text>}
    {report?.total !== undefined && <><Group><Badge>{report.matched}/{report.total} clientes identificados</Badge><Badge color="green">{report.updated} atualizados</Badge><Badge>{report.routing?.changed || 0} e-mails reclassificados</Badge><Badge color="orange">{report.pending} com pendências</Badge></Group><ScrollArea h={360}><Table><Table.Thead><Table.Tr><Table.Th>Cliente</Table.Th><Table.Th>Resultado</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{report.results?.map((row) => <Table.Tr key={row.clientId}><Table.Td>{row.client}</Table.Td><Table.Td>{row.issues.length ? row.issues.join(" · ") : row.updated ? "Responsáveis sincronizados" : "Atualizado com o Notion"}</Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea></>}
  </Stack></Modal></>;
}
