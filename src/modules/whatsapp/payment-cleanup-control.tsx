"use client";
import { useState } from "react";
import { Alert, Button, Group, Modal, Paper, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { IconEraser, IconRestore } from "@tabler/icons-react";
import type { PaymentCleanupRange } from "./payment-cleanup";
type Preview = { count: number; pending: number; checked: number; fingerprint: string };
type Last = { batchId: string; count: number };
async function payload(response: Response) { const body = await response.json(); if (!response.ok) throw Error(body.error || "Não foi possível concluir."); return body; }
export function PaymentCleanupControl({ enabled }: { enabled: boolean }) {
  const [opened, setOpened] = useState(false), [mode, setMode] = useState<PaymentCleanupRange["mode"]>("BEFORE");
  const [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [last, setLast] = useState<Last | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  if (!enabled) return null;
  async function open() {
    setOpened(true); setError(""); setMessage(""); setPreview(null);
    try { setLast((await payload(await fetch("/api/whatsapp/payment-requests/cleanup", { cache: "no-store" }))).lastCleanup); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível consultar a última limpeza."); }
  }
  async function run(action: "PREVIEW" | "CLEAR" | "RESTORE") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const range = { mode, ...(mode === "PERIOD" ? { from } : {}), to };
      const body = await payload(await fetch("/api/whatsapp/payment-requests/cleanup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "RESTORE" ? { action, batchId: last?.batchId } : { action, range, ...(action === "CLEAR" ? { fingerprint: preview?.fingerprint } : {}) }) }));
      if (action === "PREVIEW") setPreview(body);
      else {
        setPreview(null); setLast(action === "CLEAR" ? body : null);
        setMessage(action === "CLEAR" ? `${body.count} alerta(s) retirado(s) da lista.` : `${body.count} alerta(s) restaurado(s).`);
        window.dispatchEvent(new Event("fortuno:payment-requests"));
      }
    } catch (e) { setPreview(null); setError(e instanceof Error ? e.message : "Não foi possível concluir."); }
    finally { setBusy(false); }
  }
  return <><Button variant="subtle" color="gray" size="xs" leftSection={<IconEraser size={15} />} onClick={() => void open()}>Limpar alertas</Button>
    <Modal opened={opened} onClose={() => !busy && setOpened(false)} title="Limpar alertas de pagamento" centered size="md" closeOnClickOutside={!busy} closeOnEscape={!busy}>
      <Stack>
        <Text size="sm" c="dimmed">Retire alertas antigos de todos os clientes desta conexão. Mensagens, conferências e lançamentos no CA são preservados.</Text>
        <SegmentedControl value={mode} onChange={value => { setMode(value as PaymentCleanupRange["mode"]); setPreview(null); }} data={[{ value: "BEFORE", label: "Mais antigos que uma data" }, { value: "PERIOD", label: "Período específico" }]} disabled={busy} />
        <Group grow>{mode === "PERIOD" && <TextInput type="date" label="De" value={from} onChange={event => { setFrom(event.currentTarget.value); setPreview(null); }} disabled={busy} />}<TextInput type="date" label={mode === "BEFORE" ? "Anteriores a (esta data fica de fora)" : "Até (incluindo este dia)"} value={to} onChange={event => { setTo(event.currentTarget.value); setPreview(null); }} disabled={busy} /></Group>
        <Text size="xs" c="dimmed">Datas consideradas no horário de Brasília. Inclui alertas pendentes e já conferidos.</Text>
        {error && <Alert color="red">{error}</Alert>}{message && <Alert color="teal">{message}</Alert>}
        <Button variant="light" onClick={() => void run("PREVIEW")} loading={busy} disabled={!to || mode === "PERIOD" && !from}>Conferir quantidade</Button>
        {preview && <Paper withBorder p="md" radius="md"><Stack gap="xs"><Text fw={750}>{preview.count} alerta(s) nesta seleção</Text><Text size="sm">{preview.pending} pendente(s) · {preview.checked} já conferido(s)</Text><Text size="xs" c="dimmed">A limpeza pode ser desfeita. Confira o período antes de confirmar.</Text><Button color="orange" disabled={!preview.count} loading={busy} onClick={() => void run("CLEAR")}>Limpar estes {preview.count} alertas</Button></Stack></Paper>}
        {last && <Button variant="subtle" leftSection={<IconRestore size={15} />} loading={busy} onClick={() => void run("RESTORE")}>Desfazer última limpeza ({last.count})</Button>}
      </Stack>
    </Modal></>;
}
