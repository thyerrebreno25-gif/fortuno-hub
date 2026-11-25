"use client";
import { useState } from "react";
import { notifications } from "@mantine/notifications";
import { announceOperationTimerChange } from "./timer-client";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
type Preview = { activities: number; allActivities:number; configurations: number; restoreId: string | null;preserveDay:string;protectedActivities:number;removableActivities:number;futureActivities:number };
export function OperationsResetControl({ onChanged }: { onChanged: () => void }) {
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  async function open() {
    setOpened(true); setBusy(true); setError("");
    try { const response = await fetch("/api/operations/reset", { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setPreview(body); }
    catch { setError("Não foi possível consultar as rotinas."); } finally { setBusy(false); }
  }
  async function submit(action: "archive" | "restore",scope:"pending"|"all"|"except_today"|"future_only"="pending") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, scope,...((scope==="except_today"||scope==="future_only")?{preserveDay:preview?.preserveDay}:{}), restoreId: preview?.restoreId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setOpened(false); announceOperationTimerChange(); onChanged(); notifications.show({color:"green",message:action==="restore"?"Última limpeza desfeita.":`${body.activities} atividades retiradas e ${body.configurations} rotinas desativadas.${scope==="future_only"?" Histórico e atividades de hoje preservados.":scope==="except_today"?` ${body.protectedActivities} atividades de hoje ou em execução preservadas.`:""}`});
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir."); } finally { setBusy(false); }
  }
  return <><Button variant="subtle" color="gray" size="xs" onClick={() => void open()}>Limpar rotinas</Button><Modal opened={opened} onClose={() => !busy && setOpened(false)} title="Limpar gestão de tarefas" centered><Stack>
    {error && <Alert color="red">{error}</Alert>}
    {preview && <><Alert color="blue" title={`Preservar histórico e hoje · ${preview.preserveDay.split("-").reverse().join("/")}`}><Text size="sm">Retirar somente {preview.futureActivities} tarefas futuras, a partir de amanhã, e desativar {preview.configurations} rotinas configuradas. Manter as {preview.protectedActivities} atividades de hoje, todo o histórico anterior e tarefas que já tenham tempo registrado. Checklists, anexos, tempos e indicadores dos registros mantidos permanecem disponíveis.</Text><Button mt="sm" loading={busy} disabled={!preview.configurations&&!preview.futureActivities} onClick={()=>void submit("archive","future_only")}>Limpar somente futuras e rotinas</Button></Alert><Text size="sm">{preview.allActivities-preview.futureActivities} atividades serão mantidas. A limpeza é reversível em Desfazer última limpeza.</Text>{preview.restoreId && <Button variant="default" loading={busy} onClick={() => void submit("restore")}>Desfazer última limpeza</Button>}<details><summary>Outras opções de limpeza</summary><Text size="sm" c="red" my="sm">Estas opções também retiram tarefas de hoje e dados anteriores dos indicadores.</Text><Group justify="flex-end"><Button color="red" loading={busy} disabled={!preview.configurations && !preview.activities} onClick={() => void submit("archive")}>Limpar somente pendentes</Button><Button color="red" loading={busy} disabled={!preview.configurations&&!preview.allActivities} onClick={()=>void submit("archive","all")}>Zerar todas as atividades ({preview.allActivities})</Button></Group></details></>}
  </Stack></Modal></>;
}
