"use client";
import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
type Preview = { activities: number; configurations: number; restoreId: string | null };
export function OperationsResetControl({ onChanged }: { onChanged: () => void }) {
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  async function open() {
    setOpened(true); setBusy(true); setError("");
    try { const response = await fetch("/api/operations/reset", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setPreview(body); }
    catch { setError("Não foi possível consultar as rotinas."); } finally { setBusy(false); }
  }
  async function submit(action: "archive" | "restore") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, restoreId: preview?.restoreId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setOpened(false); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }
  return <><Button variant="subtle" color="gray" size="xs" onClick={() => void open()}>Limpar rotinas</Button><Modal opened={opened} onClose={() => !busy && setOpened(false)} title="Limpar rotinas atuais" centered><Stack>
    {error && <Alert color="red">{error}</Alert>}
    {preview && <><Text>{preview.configurations} rotinas configuradas e {preview.activities} atividades pendentes, vencidas ou futuras.</Text><Text size="sm" c="dimmed">As recorrências serão desativadas. Atividades concluídas e histórico ficam preservados.</Text><Group justify="flex-end">{preview.restoreId && <Button variant="default" loading={busy} onClick={() => void submit("restore")}>Desfazer última limpeza</Button>}<Button color="red" loading={busy} disabled={!preview.configurations && !preview.activities} onClick={() => void submit("archive")}>Remover rotinas atuais</Button></Group></>}
  </Stack></Modal></>;
}
