"use client";
import { useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, ScrollArea, Select, Stack, Table, Text } from "@mantine/core";
import { beginSessionKeepAlive } from "@/modules/session/client-activity";
type Line = { id: string; description: string; amount: string | number; dueDate: string; status: string; lastError: string | null; externalInstallmentId: string | null };
type Batch = { id: string; sourceName: string; status: string; financialAccountName: string | null; settleRequested: boolean; createdAt: string; lastError: string | null; _count: { lines: number }; lines: Line[] };
type Check = { lineId: string; status: string; message: string };
const labels: Record<string, string> = { PENDING: "Aguardando envio", CREATED: "Criação registrada", SETTLED: "Baixa registrada", FAILED: "Falha", PROCESSING: "Em processamento", PARTIAL: "Parcial", COMPLETED: "Concluído no histórico" };
export function FinancialExportHistory({ clientId, clients, exportModule }: { clientId: string | null; clients: { value: string; label: string }[]; exportModule: "CREDIT_CARD_INVOICE" | "ACQUIRER" }) {
  const [opened, setOpened] = useState(false), [selected, setSelected] = useState<string | null>(null), [batches, setBatches] = useState<Batch[]>([]), [checks, setChecks] = useState<Record<string, Check>>({}), [pages, setPages] = useState<Record<string, number>>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  const [operation, setOperation] = useState<{ batch: Batch; kind: "PREPARE" | "SEND" } | null>(null), [confirmed, setConfirmed] = useState(false), [notice, setNotice] = useState("");
  async function load(id: string | null, batch?: Batch) {
    if (!id) return;
    const run = ++generation.current;
    setBusy(true); setError("");
    const page = batch ? pages[batch.id] || 0 : 0;
    const params = new URLSearchParams({ clientId: id, module: exportModule, ...(batch ? { exportId: batch.id, verify: "1", page: String(page) } : {}) });
    try {
      const response = await fetch("/api/integrations/conta-azul/financial-exports/history?" + params, { cache: "no-store" });
      const body = await response.json();
      if (run !== generation.current) return;
      if (!response.ok) throw new Error(body.error || "Não foi possível consultar os envios.");
      if (batch) {
        setChecks((previous) => ({ ...previous, ...Object.fromEntries((body.checks || []).map((check: Check) => [check.lineId, check])) }));
        setPages((previous) => ({ ...previous, [batch.id]: page + 1 }));
        const extra: Line[] = body.batches[0]?.lines || [];
        setBatches((previous) => previous.map((item) => item.id === batch.id ? { ...item, lines: Array.from(new Map([...item.lines, ...extra].map((line) => [line.id, line])).values()) } : item));
      } else { setBatches(body.batches); setChecks({}); setPages({}); }
    } catch (cause) { if (run === generation.current) setError(cause instanceof Error ? cause.message : "Falha na consulta."); }
    finally { if (run === generation.current) setBusy(false); }
  }
  async function performOperation() {
    if (!operation || !confirmed) return;
    const action = operation;
    setOperation(null); setBusy(true); setError(""); setNotice(""); generation.current++;
    const release = beginSessionKeepAlive();
    try {
      if (action.kind === "PREPARE") {
        const response = await fetch("/api/integrations/conta-azul/financial-exports/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exportId: action.batch.id, confirmation: "PREPARAR REENVIO", lineIds: action.batch.lines.filter((line) => checks[line.id]?.status === "NOT_FOUND").map((line) => line.id).slice(0, 20) }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível preparar o envio.");
        setNotice(body.prepared + " item(ns) preparados para retomada. Nenhum lançamento enviado ao CA.");
        if (body.blocked?.length) setError(body.blocked.map((item: { description: string; reason: string }) => item.description + ": " + item.reason).join(" "));
      } else {
        let done = false;
        for (let attempt = 0; attempt < 80; attempt++) {
          const response = await fetch("/api/integrations/conta-azul/financial-exports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resumeExportId: action.batch.id, confirmation: "ENVIAR AO CA" }) });
          const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível retomar o envio.");
          setNotice(body.message || "Envio em andamento.");
          if (body.done) { done = true; break; }
          if (!body.needsContinue) throw new Error(body.message || "Envio parcial. Confira os itens antes de retomar.");
        }
        if (!done) throw new Error("O envio continua pendente. Confira o histórico antes de retomar.");
      }
      if (selected) { const response = await fetch("/api/integrations/conta-azul/financial-exports/history?" + new URLSearchParams({ clientId: selected, module: exportModule }), { cache: "no-store" }); if (response.ok) { setBatches((await response.json()).batches); setChecks({}); setPages({}); } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "A operação não foi concluída."); }
    finally { setBusy(false); release(); }
  }
  return <><Button variant="default" onClick={() => { const id = clientId || selected; setSelected(id); setOpened(true); if (id) void load(id); }}>Envios ao CA</Button>
    <Modal opened={opened} onClose={() => !busy && setOpened(false)} title="Histórico de envios ao Conta Azul" size="90%"><Stack>
      <Group align="flex-end"><Select label="Cliente do envio" disabled={busy} searchable clearable data={clients} value={selected} style={{ flex: 1 }} onChange={(id) => { generation.current++; setBusy(false); setSelected(id); setBatches([]); setChecks({}); setPages({}); if (id) void load(id); }} /><Button variant="light" loading={busy} disabled={!selected} onClick={() => void load(selected)}>Atualizar histórico</Button></Group>
      <Text size="sm" c="dimmed">A conferência consulta o CA sem criar ou reenviar lançamentos. Cada clique confere até 20 itens.</Text>
      {notice && <Alert color="blue">{notice}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
      {selected && !busy && !batches.length && <Text>Nenhum envio registrado para este cliente neste módulo.</Text>}
      {batches.map((batch) => <Paper key={batch.id} withBorder p="md"><Stack gap="sm">
        <Group justify="space-between"><div><Text fw={700}>{batch.sourceName}</Text><Text size="xs" c="dimmed">{new Date(batch.createdAt).toLocaleString("pt-BR")} · {batch.financialAccountName || "Conta não informada"} · {batch._count.lines} lançamento(s)</Text></div><Badge color={batch.status === "COMPLETED" ? "blue" : "orange"}>{labels[batch.status] || batch.status}</Badge></Group>
        {batch.lastError && <Alert color="orange">{batch.lastError}</Alert>}
        <Group><Button variant="light" loading={busy} disabled={busy || (pages[batch.id] || 0) * 20 >= batch._count.lines} onClick={() => void load(selected, batch)}>{pages[batch.id] ? "Conferir próximos 20 no CA" : "Conferir no CA"}</Button><Text size="xs" c="dimmed">{Math.min((pages[batch.id] || 0) * 20, batch._count.lines)} de {batch._count.lines} consultados</Text></Group>
        <Group>{batch.status !== "COMPLETED" && <Button variant="default" disabled={busy} onClick={() => { setConfirmed(false); setOperation({ batch, kind: "SEND" }); }}>Retomar envio salvo</Button>}{batch.lines.some((line) => line.status === "FAILED" || checks[line.id]?.status === "NOT_FOUND") && <Button variant="subtle" color="orange" disabled={busy} onClick={() => { setConfirmed(false); setOperation({ batch, kind: "PREPARE" }); }}>Preparar itens não localizados</Button>}</Group>
        <ScrollArea h={300}><Table striped withTableBorder miw={850}><Table.Thead><Table.Tr><Table.Th>Lançamento</Table.Th><Table.Th>Valor</Table.Th><Table.Th>Vencimento</Table.Th><Table.Th>Etapa no Hub</Table.Th><Table.Th>Conferência no CA</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{batch.lines.map((line) => <Table.Tr key={line.id}><Table.Td><Text size="sm">{line.description}</Text>{line.lastError && <Text size="xs" c="red">{line.lastError}</Text>}</Table.Td><Table.Td>{Number(line.amount).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</Table.Td><Table.Td>{new Date(line.dueDate).toLocaleDateString("pt-BR", { timeZone: "UTC" })}</Table.Td><Table.Td>{labels[line.status] || line.status}</Table.Td><Table.Td><Text size="xs" c={checks[line.id]?.status === "CONFIRMED" ? "green" : checks[line.id] ? "orange" : "dimmed"}>{checks[line.id]?.message || "Ainda não consultado"}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>
        {batch.lines.length < batch._count.lines && <Text size="xs" c="dimmed">Exibindo {batch.lines.length} de {batch._count.lines} itens; a conferência carrega os próximos itens.</Text>}
      </Stack></Paper>)}
    </Stack></Modal>
    <Modal opened={Boolean(operation)} onClose={() => setOperation(null)} title={operation?.kind === "SEND" ? "Confirmar retomada real no CA" : "Conferir itens não localizados"}><Stack>
      <Text fw={700}>{operation?.batch.sourceName}</Text><Text>{clients.find((item) => item.value === selected)?.label}</Text><Text size="sm">{operation?.batch._count.lines} lançamento(s) · {operation?.batch.financialAccountName}</Text>
      <Text size="sm">{operation?.kind === "SEND" ? "A retomada utiliza os valores, datas, categorias e contas salvos neste envio. Etapas já concluídas serão preservadas." : "Serão conferidos até 20 itens com falha. Somente referências antigas comprovadamente ausentes no CA serão preparadas; os identificadores anteriores serão preservados na auditoria. Esta etapa não envia lançamentos."}</Text>
      <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} label={operation?.kind === "SEND" ? "Conferi os dados do envio e confirmo a retomada real no Conta Azul." : "Confirmo a conferência e preparação dos itens ausentes, sem envio ao CA."} />
      <Group justify="flex-end"><Button variant="default" onClick={() => setOperation(null)}>Cancelar</Button><Button disabled={!confirmed} onClick={() => void performOperation()}>{operation?.kind === "SEND" ? "Confirmar envio ao CA" : "Conferir e preparar"}</Button></Group>
    </Stack></Modal></>;

}
