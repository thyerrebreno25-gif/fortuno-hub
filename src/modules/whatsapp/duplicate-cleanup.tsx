"use client";
import { Alert, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { useState } from "react";
type Preview = { fingerprint: string; groups: Array<{ name: string; count: number; messages: number; conflict: string | null }> };
export function WhatsAppDuplicateCleanup() {
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<{ merged: number; messages: number; skipped: string[] } | null>(null);
  async function load() {
    setBusy(true); setError(""); setResult(null);
    try { const response = await fetch("/api/whatsapp/duplicates", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setPreview(data); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao verificar duplicados."); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview) return; setBusy(true); setError("");
    try { const response = await fetch("/api/whatsapp/duplicates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "UNIR_ATENDIMENTOS", fingerprint: preview.fingerprint }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setResult(data); setPreview(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao reunir duplicados."); } finally { setBusy(false); }
  }
  return <Paper withBorder radius="md" p="lg"><Stack gap="sm"><Text fw={750}>Atendimentos duplicados por reconexão</Text><Text size="sm" c="dimmed">Reúna conversas ativas repetidas do mesmo contato ou grupo. Mensagens, anexos e histórico serão preservados, mantendo o responsável definido.</Text>
    <Group><Button variant="light" loading={busy} onClick={load}>Verificar atendimentos duplicados</Button></Group>
    {error && <Alert color="red">{error}</Alert>}
    {preview && <><Text size="sm" fw={600}>{preview.groups.length ? "Prévia dos atendimentos encontrados" : "Nenhum atendimento ativo duplicado encontrado."}</Text>{preview.groups.map((item, index) => <Paper key={index} withBorder p="sm" radius="sm"><Text fw={650} size="sm">{item.name}</Text><Text size="xs" c="dimmed">{item.count} atendimentos · {item.messages} mensagens</Text>{item.conflict && <Text size="xs" c="orange">Mantido separado: {item.conflict}</Text>}</Paper>)}{preview.groups.some((item) => !item.conflict) && <Group><Button color="teal" loading={busy} onClick={confirm}>Confirmar união dos duplicados</Button><Button variant="default" disabled={busy} onClick={() => setPreview(null)}>Cancelar</Button></Group>}</>}
    {result && <Alert color={result.skipped.length ? "orange" : "green"}><Text size="sm">{result.merged} registro(s) duplicado(s) reunido(s). {result.messages} mensagem(ns) movida(s), com histórico e anexos preservados.</Text>{result.skipped.length > 0 && <Text size="xs">Casos mantidos separados: {result.skipped.join("; ")}</Text>}</Alert>}
  </Stack></Paper>;
}
