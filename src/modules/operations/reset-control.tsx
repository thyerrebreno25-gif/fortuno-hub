"use client";
import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { announceOperationTimerChange } from "./timer-client";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
type Preview = { activities: number; allActivities:number; configurations: number; restoreId: string | null };
export function OperationsResetControl({ onChanged }: { onChanged: () => void }) {
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  async function open() {
    setOpened(true); setBusy(true); setError("");
    try { const response = await fetch("/api/operations/reset", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setPreview(body); }
    catch { setError("Não foi possível consultar as rotinas."); } finally { setBusy(false); }
  }
  async function submit(action: "archive" | "restore",scope:"pending"|"all"="pending") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, scope, restoreId: preview?.restoreId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setOpened(false); announceOperationTimerChange(); onChanged(); notifications.show({color:"green",message:action==="restore"?"Última limpeza desfeita.":`${body.activities} atividades retiradas e ${body.configurations} rotinas desativadas.`});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }
  return <><Button variant="subtle" color="gray" size="xs" onClick={() => void open()}>Limpar rotinas</Button><Modal opened={opened} onClose={() => !busy && setOpened(false)} title="Limpar gestão de tarefas" centered><Stack>
    {error && <Alert color="red">{error}</Alert>}
    {preview && <><Text>{preview.configurations} rotinas configuradas e {preview.activities} atividades pendentes, vencidas ou futuras.</Text><Text size="sm" c="dimmed">Você pode retirar apenas as pendentes ou zerar todas as atividades, incluindo concluídas e seus apontamentos nos painéis. Clientes, equipe e tipos de processo permanecem cadastrados. A última limpeza pode ser desfeita aqui.</Text><Group justify="flex-end">{preview.restoreId && <Button variant="default" loading={busy} onClick={() => void submit("restore")}>Desfazer última limpeza</Button>}<Button color="red" loading={busy} disabled={!preview.configurations && !preview.activities} onClick={() => void submit("archive")}>Limpar somente pendentes</Button><Button color="red" loading={busy} disabled={!preview.configurations&&!preview.allActivities} onClick={()=>void submit("archive","all")}>Zerar todas as atividades ({preview.allActivities})</Button></Group></>}
  </Stack></Modal></>;
}
