"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import type { OperationsAnalytics } from "@/modules/operations/analytics";
import { balanceValidation, caBalanceSummary, reconciliationStatus, type AccountCheck, type ManagementSnapshot } from "@/modules/management/model";

type Client = { contaAzulConnection: { active: boolean; status: string } | null; management: { snapshot: ManagementSnapshot | null; checkedAccounts: Record<string, AccountCheck>; lastError: string | null } | null };
type Management = { clients: Client[]; sync?: { configured: boolean; lastFinishedAt?: string; lastError?: string } };
type Mail = { stats: { general: number; unassigned: number; waiting: number } };
type Connection = { connected: boolean; recovering?: boolean; connection: { lastSyncAt: string | null } | null; sync?: { lastError: string | null } | null };
type Data = { tasks?: OperationsAnalytics; management?: Management; mail?: Mail; connection?: Connection; errors: string[]; updatedAt: string };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "Aguardando primeira consulta";

export function IntegratedOverview() {
  const [data, setData] = useState<Data | null>(null);
  useEffect(() => {
    let active = true, running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const response = await fetch("/api/permissions/me", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Não foi possível consultar suas permissões.");
        const permissions = (await response.json()).permissions as Record<string, { canView?: boolean }>;
        const result: Data = { errors: [], updatedAt: new Date().toISOString() };
        const sources = [
          ["OPERATIONS", "tasks", "/api/operations/analytics", "Tarefas"],
          ["MANAGEMENT", "management", "/api/management", "Gestão financeira"],
          ["SERVICE_CENTER", "mail", "/api/atendimento?view=GENERAL", "Central de e-mails"],
          ["SERVICE_CENTER", "connection", "/api/atendimento/gmail/status", "Conexão Gmail"],
        ] as const;
        await Promise.all(sources.map(async ([module, key, url, label]) => {
          if (!permissions[module]?.canView) return;
          try {
            const source = await fetch(url, { cache: "no-store", signal: controller.signal });
            if (!source.ok) throw new Error();
            Object.assign(result, { [key]: await source.json() });
          } catch { result.errors.push(label); }
        }));
        if (active) setData(result);
      } catch { if (active) setData({ errors: ["Resumo integrado"], updatedAt: new Date().toISOString() }); }
      finally { running = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    return () => { active = false; controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, []);
  if (!data) return <Text size="sm" c="dimmed">Consultando resumo integrado...</Text>;
  const clients = data.management?.clients || [];
  const connected = clients.filter((c) => c.contaAzulConnection?.active && c.contaAzulConnection.status === "CONNECTED");
  const snapshots = connected.flatMap((c) => c.management?.snapshot ? [c.management.snapshot] : []);
  const complete = snapshots.length === connected.length && connected.length > 0 && snapshots.every((s) => s.payable.complete && !s.payable.error && s.receivable.complete && !s.receivable.error);
  const divergent = connected.filter((c) => c.management?.snapshot?.accounts.some((a) => balanceValidation(a, c.management?.checkedAccounts[a.id]).status === "DIVERGENT")).length;
  const pending = connected.filter((c) => c.management?.snapshot?.accounts.some((a) => reconciliationStatus(c.management?.checkedAccounts[a.id]) === "PENDING")).length;
  const balances = snapshots.map(caBalanceSummary);
  const allBalances = snapshots.length === connected.length && connected.length > 0 && balances.every((b) => b.complete);
  const unknownChecks = connected.filter((c) => !c.management?.snapshot?.accounts.length || c.management.snapshot.accounts.some((a) => ["UNKNOWN", "STALE"].includes(balanceValidation(a, c.management?.checkedAccounts[a.id]).status) || ["UNKNOWN", "STALE"].includes(reconciliationStatus(c.management?.checkedAccounts[a.id])))).length;
  if (!data.tasks && !data.management && !data.mail && !data.errors.length) return null;
  return <Paper withBorder radius="lg" p="lg"><Stack gap="sm">
    <Group justify="space-between"><Title order={4}>Resumo integrado da operação</Title><Badge variant="light">Atualizado {date(data.updatedAt)}</Badge></Group>
    {data.errors.length > 0 && <Alert color="orange">Dados indisponíveis: {data.errors.join(", ")}. Abra a tela de origem para consultar o motivo.</Alert>}
    <SimpleGrid cols={{ base: 1, md: 3 }}>
      {data.tasks && <Paper withBorder p="md" radius="md"><Text fw={700}>Tempo e tarefas · este mês</Text><Text fz={27} fw={800}>{Math.floor(data.tasks.summary.seconds / 3600)}h {Math.floor(data.tasks.summary.seconds % 3600 / 60)}m</Text><Text size="sm">{data.tasks.summary.pending} pendentes · {data.tasks.summary.overdue} atrasadas · {data.tasks.summary.completed} concluídas</Text><Text size="xs" c="dimmed">{data.tasks.summary.withoutTime} sem apontamento · inclui cronômetros ativos.</Text><Button component="a" href="/operacoes" variant="subtle" size="xs" mt="sm">Ver painel de tempo e atividades</Button></Paper>}
      {data.management && <Paper withBorder p="md" radius="md"><Text fw={700}>Gestão financeira · Conta Azul</Text><Text size="sm" mt="xs">A pagar vencido: {snapshots.length ? money(snapshots.reduce((n, s) => n + s.payable.amount, 0)) : "Não consultado"}</Text><Text size="sm">A receber vencido: {snapshots.length ? money(snapshots.reduce((n, s) => n + s.receivable.amount, 0)) : "Não consultado"}</Text><Text size="sm">Saldo CA: {balances.some((b) => b.amount !== null) ? money(balances.reduce((n, b) => n + (b.amount || 0), 0)) : "Indisponível"}{!allBalances && " · parcial / indisponível"}</Text><Text size="xs" c={complete ? "dimmed" : "orange"}>{snapshots.length}/{connected.length} conectados com consulta · {complete ? "Totais consultados" : "Totais parciais / indisponíveis"}</Text><Text size="xs">{clients.filter((c) => c.contaAzulConnection?.active && c.contaAzulConnection.status !== "CONNECTED").length} conexões com falha · {divergent} clientes com saldo divergente · {pending} com conciliação pendente informada</Text><Text size="xs" c="dimmed">{unknownChecks} conferências manuais incompletas ou antigas.</Text><Text size="xs" c="dimmed">CA: atualização a cada 15 minutos · última verificação: {date(data.management.sync?.lastFinishedAt)}.</Text>{!data.management.sync?.configured && <Text size="xs" c="orange">Agendamento na nuvem pendente.</Text>}<Button component="a" href="/gestao" variant="subtle" size="xs" mt="sm">Ver clientes e conferências</Button></Paper>}
      {data.mail && <Paper withBorder p="md" radius="md"><Text fw={700}>Central de e-mails</Text><Text fz={27} fw={800}>{data.mail.stats.general} na caixa</Text><Text size="sm">{data.mail.stats.unassigned} sem responsável · {data.mail.stats.waiting} aguardando</Text><Text size="xs" c={data.connection?.sync?.lastError ? "orange" : "dimmed"}>{data.connection?.sync?.lastError || (data.connection?.recovering ? "Recuperando Caixa de entrada…" : data.connection?.connected ? `Última consulta Gmail: ${date(data.connection.connection?.lastSyncAt)} · automática a cada 5 minutos` : "Gmail não conectado")}</Text><Button component="a" href="/atendimento" variant="subtle" size="xs" mt="sm">Abrir Central de e-mails</Button></Paper>}
    </SimpleGrid>
  </Stack></Paper>;
}
