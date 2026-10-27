"use client";
import { IntegratedOverview } from "@/modules/dashboard/integrated-overview";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, NumberInput, Paper, ScrollArea, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Title } from "@mantine/core";
import { IconRefresh, IconSearch, IconChecklist, IconAlertTriangle } from "@tabler/icons-react";
import { balanceValidation, caBalanceSummary, localDay, reconciliationStatus, type AccountCheck, type AccountSnapshot, type ManagementSnapshot } from "./model";
type Client = { id: string; name: string; document: string | null; cluster: string; operationLeader: { name: string | null } | null; contaAzulConnection: { active: boolean; status: string } | null; management: { snapshot: ManagementSnapshot | null; checkedAccounts: Record<string, AccountCheck>; notionPageId: string | null; revision: number; lastError: string | null } | null };
type Payload = { clients: Client[]; canEdit: boolean; canManage: boolean; sync?: { intervalMinutes: number; configured: boolean; setupError: string | null; lastFinishedAt?: string; lastStartedAt?: string; running: boolean; lastError?: string } };
const money = (value: number | null | undefined) => value == null ? "Não disponível" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const when = (value?: string | null) => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Não informado";
const labels: Record<string, string> = { OK: "OK", DIVERGENT: "Divergente", UNKNOWN: "Não conferido", STALE: "Atualizar conferência", PENDING: "Pendente" };
const color = (status: string) => status === "OK" ? "green" : status === "DIVERGENT" || status === "PENDING" ? "red" : status === "STALE" ? "orange" : "gray";
const connected = (client: Client) => Boolean(client.contaAzulConnection?.active && client.contaAzulConnection.status === "CONNECTED");
function aggregate(client: Client, kind: "balance" | "reconciliation") {
  const snapshot = client.management?.snapshot;
  if (!connected(client) || !snapshot || !snapshot.accounts.length) return "UNKNOWN";
  const statuses = snapshot.accounts.map((account) => kind === "balance" ? balanceValidation(account, client.management?.checkedAccounts[account.id]).status : reconciliationStatus(client.management?.checkedAccounts[account.id]));
  if (statuses.includes("DIVERGENT")) return "DIVERGENT";
  if (statuses.includes("PENDING")) return "PENDING";
  if (!snapshot.accountsComplete || snapshot.accountsError || statuses.includes("UNKNOWN")) return "UNKNOWN";
  if (statuses.includes("STALE")) return "STALE";
  return "OK";
}
function lastImport(client: Client) {
  const accounts = client.management?.snapshot?.accounts || [];
  const dates = accounts.map((account) => client.management?.checkedAccounts[account.id]?.lastImportAt);
  if (!dates.length || dates.some((date) => !date)) return null;
  return dates.sort()[0];
}
async function payload(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Falha na consulta.");
  return result;
}
const localInput = (value?: string | null) => value ? new Date(new Date(value).getTime() - 3 * 3600000).toISOString().slice(0, 16) : "";
const toIso = (value: string) => value ? new Date(`${value}:00-03:00`).toISOString() : null;

export function ManagementPage() {
  const [data, setData] = useState<Payload>({ clients: [], canEdit: false, canManage: false }), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null), [query, setQuery] = useState(""), [filter, setFilter] = useState<string | null>("ALL"), [busy, setBusy] = useState<string | null>(null), [progress, setProgress] = useState("");
  const [editing, setEditing] = useState<AccountSnapshot | null>(null), [saving, setSaving] = useState(false), [pageLink, setPageLink] = useState("");
  const [form, setForm] = useState({ bankBalance: "" as number | string, balanceAt: "", lastImportAt: "", pendingPayable: "" as number | string, pendingReceivable: "" as number | string, note: "" });
  const refreshLock = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    const next = await payload(await fetch("/api/management", { cache: "no-store" })) as Payload;
    if (mounted.current) setData(next);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message)).finally(() => setLoading(false));
    const startSync = () => fetch("/api/management/sync", { method: "POST" }).catch(() => undefined);
    void startSync();
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => {}); }, 15000);
    const sync = window.setInterval(() => { if (document.visibilityState === "visible") void startSync(); }, 15 * 60000);
    const visible = () => { if (document.visibilityState === "visible") { void load().catch(() => {}); void startSync(); } };
    document.addEventListener("visibilitychange", visible);
    return () => { window.clearInterval(poll); window.clearInterval(sync); document.removeEventListener("visibilitychange", visible); };
  }, [load]);
  const selected = data.clients.find((client) => client.id === selectedId);
  const connectionErrors = data.clients.filter((client) => client.contaAzulConnection?.active && client.contaAzulConnection.status !== "CONNECTED");
  const visible = useMemo(() => data.clients.filter((client) => `${client.name} ${client.document || ""}`.toLowerCase().includes(query.toLowerCase())).filter((client) => filter === "DIVERGENT" ? aggregate(client, "balance") === "DIVERGENT" : filter === "OVERDUE" ? (client.management?.snapshot?.payable.count || 0) + (client.management?.snapshot?.receivable.count || 0) > 0 : filter === "UNKNOWN" ? !client.management?.snapshot : true), [data.clients, query, filter]);
  const summary = useMemo(() => ({ connected: data.clients.filter(connected).length, overdue: data.clients.filter((c) => (c.management?.snapshot?.payable.count || 0) + (c.management?.snapshot?.receivable.count || 0) > 0).length, divergent: data.clients.filter((c) => aggregate(c, "balance") === "DIVERGENT").length, unverified: data.clients.filter((c) => aggregate(c, "balance") === "UNKNOWN" || aggregate(c, "balance") === "STALE").length }), [data.clients]);
  async function refresh(clients: Client[]) {
    if (refreshLock.current) return;
    refreshLock.current = true; setError("");
    const failures: string[] = [];
    try {
      for (let index = 0; index < clients.length; index++) {
        if (!mounted.current) break;
        const client = clients[index]; setBusy(client.id); setProgress(`${index + 1}/${clients.length} · ${client.name}`);
        try { await payload(await fetch("/api/management", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id }) })); }
        catch (e) { failures.push(`${client.name}: ${e instanceof Error ? e.message : "Falha ao atualizar"}`); }
        await load();
      }
      if (failures.length) setError(failures.join("\n"));
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível atualizar."); }
    finally { refreshLock.current = false; if (mounted.current) { setBusy(null); setProgress(""); } }
  }
  function edit(account: AccountSnapshot) {
    const check = selected?.management?.checkedAccounts[account.id];
    setForm({ bankBalance: check?.bankBalance ?? "", balanceAt: localInput(check?.balanceAt), lastImportAt: localInput(check?.lastImportAt), pendingPayable: check?.pendingPayable ?? "", pendingReceivable: check?.pendingReceivable ?? "", note: check?.note || "" });
    setEditing(account);
  }
  async function saveCheck() {
    if (!selected || !editing) return;
    setSaving(true); setError("");
    try {
      await payload(await fetch("/api/management", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: selected.id, accountId: editing.id, revision: selected.management?.revision, bankBalance: form.bankBalance === "" ? null : Number(form.bankBalance), balanceAt: toIso(form.balanceAt), lastImportAt: toIso(form.lastImportAt), pendingPayable: form.pendingPayable === "" ? null : Number(form.pendingPayable), pendingReceivable: form.pendingReceivable === "" ? null : Number(form.pendingReceivable), note: form.note }) }));
      setEditing(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setSaving(false); }
  }
  async function saveNotion() {
    if (!selected) return;
    let pageId: string | null = null;
    if (pageLink.trim()) {
      const match = pageLink.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/i);
      if (!match) { setError("Cole o link ou UUID da página do cliente no Notion."); return; }
      const raw = match[0].replaceAll("-", ""); pageId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
    }
    setSaving(true); setError("");
    try { await payload(await fetch("/api/management", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: selected.id, action: "notion", pageId }) })); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Falha ao vincular."); }
    finally { setSaving(false); }
  }
  if (loading) return <Group justify="center" py={80}><Loader /></Group>;
  const snapshot = selected?.management?.snapshot;
  return <Stack gap="lg">
    <Group justify="space-between"><div><Title order={2}>Gestão</Title></div><Button leftSection={<IconRefresh size={16} />} loading={Boolean(busy)} disabled={!data.clients.some(connected)} onClick={() => void refresh(data.clients.filter(connected))}>Atualizar clientes conectados</Button></Group>
    <IntegratedOverview />
    {error && <Alert color="red" title="Não foi possível concluir"><Text style={{ whiteSpace: "pre-wrap" }}>{error}</Text></Alert>}
    {progress && <Alert color="blue" icon={<Loader size="xs" />}>Consultando Conta Azul: {progress}. Os dados aparecem conforme cada cliente termina.</Alert>}
    <Group justify="space-between"><Text size="xs" c="dimmed">CA · 15 min · {data.sync?.running ? "Atualizando…" : when(data.sync?.lastFinishedAt)}</Text>{connectionErrors.length > 0 && <Button component="a" href="/integracoes/conta-azul" variant="subtle" color="orange" size="xs">{connectionErrors.length} conexão com falha</Button>}{data.sync?.setupError && <Badge color="orange">Agendamento pendente</Badge>}{data.sync?.lastError && <Badge color="orange">Atualização com falhas</Badge>}</Group>
    <SimpleGrid cols={{ base: 2, md: 4 }}>{[["Clientes conectados", summary.connected, "blue"], ["Com títulos vencidos", summary.overdue, "orange"], ["Com saldo divergente", summary.divergent, "red"], ["Saldo a conferir", summary.unverified, "gray"]].map(([label, count, shade]) => <Paper key={label} withBorder radius="lg" p="lg"><Text size="sm" c="dimmed">{label}</Text><Text size="32px" fw={800} c={String(shade)}>{count}</Text></Paper>)}</SimpleGrid>
    <Paper withBorder radius="lg" p="lg"><Stack><Group justify="space-between"><Title order={4}>Visão geral dos clientes</Title><Group><TextInput aria-label="Buscar cliente" placeholder="Buscar cliente ou CNPJ" leftSection={<IconSearch size={16} />} value={query} onChange={(event) => setQuery(event.currentTarget.value)} /><Select aria-label="Filtrar situação" value={filter} onChange={setFilter} allowDeselect={false} data={[{ value: "ALL", label: "Todos os clientes" }, { value: "OVERDUE", label: "Com vencidos" }, { value: "DIVERGENT", label: "Saldo divergente" }, { value: "UNKNOWN", label: "Sem consulta ao CA" }]} /></Group></Group>
      <ScrollArea><Table highlightOnHover miw={1000}><Table.Thead><Table.Tr>{["Cliente", "Última importação no CA", "A pagar vencido", "A receber vencido", "Saldo CA · total das contas", "Validação banco × CA", "Conciliação · manual", "Consulta CA"].map((label) => <Table.Th key={label}>{label}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{visible.map((client) => { const s = client.management?.snapshot; return <Table.Tr key={client.id} bg={selectedId === client.id ? "var(--mantine-color-blue-light)" : undefined}><Table.Td><Button variant="subtle" maw={240} styles={{ label: { whiteSpace: "normal", textAlign: "left" } }} onClick={() => { setSelectedId(client.id); setPageLink(client.management?.notionPageId || ""); document.getElementById("client-management-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{client.name}</Button><Text size="xs" c="dimmed">{connected(client) ? `Cluster ${client.cluster}` : "Conta Azul desconectado"}</Text></Table.Td><Table.Td><Text size="sm">{when(lastImport(client))}</Text><Text size="xs" c="dimmed">Conferência manual · conta menos recente</Text></Table.Td>{[s?.payable, s?.receivable].map((flow, index) => <Table.Td key={index}><Text fw={700} c={flow?.count ? "orange" : undefined}>{flow ? money(flow.amount) : "Não consultado"}</Text><Text size="xs" c="dimmed">{flow ? `${flow.count} título(s)${!flow.complete || flow.error ? " · consulta parcial" : ""}` : "—"}</Text></Table.Td>)}<Table.Td><Text fw={750}>{money(caBalanceSummary(s).amount)}</Text><Text size="xs" c="dimmed">{!s ? "Aguardando consulta automática" : caBalanceSummary(s).complete ? `${s.accounts.length} conta(s) no CA` : "Saldos parciais / indisponíveis"}</Text></Table.Td>{[aggregate(client, "balance"), aggregate(client, "reconciliation")].map((status, index) => <Table.Td key={index}><Badge color={color(status)} variant="light">{labels[status]}</Badge></Table.Td>)}<Table.Td><Text size="xs" c={s && localDay(new Date(s.queriedAt)) !== localDay() ? "orange" : "dimmed"}>{s ? when(s.queriedAt) : "Ainda não consultado"}</Text>{client.management?.lastError && <Badge color="red" size="xs">Falha na consulta</Badge>}</Table.Td></Table.Tr>; })}</Table.Tbody></Table></ScrollArea>
      {!visible.length && <Text c="dimmed" ta="center" p="xl">Nenhum cliente neste filtro.</Text>}
    </Stack></Paper>
    <div id="client-management-detail" style={{ scrollMarginTop: 24 }}><Paper withBorder radius="lg" p="xl"><Stack gap="lg"><Group justify="space-between"><div><Title order={3}>{selected?.name || "Detalhamento do cliente"}</Title><Text size="sm" c="dimmed">{selected ? `${selected.document || "Sem CNPJ"} · Líder: ${selected.operationLeader?.name || "Não informado"}` : "Selecione um cliente na visão geral ou na lista ao lado."}</Text></div><Select aria-label="Cliente detalhado" placeholder="Selecione o cliente" searchable value={selectedId} onChange={(id) => { setSelectedId(id); setPageLink(data.clients.find((client) => client.id === id)?.management?.notionPageId || ""); }} data={data.clients.map((c) => ({ value: c.id, label: c.name }))} /></Group>
    {selected && <><Group><Button variant="light" leftSection={<IconRefresh size={16} />} loading={busy === selected.id} disabled={Boolean(busy) || !connected(selected)} onClick={() => void refresh([selected])}>Atualizar este cliente</Button><Button component="a" href="/integracoes/conta-azul" variant="default">Conexões Conta Azul</Button><Button component="a" href="https://app.contaazul.com/" target="_blank" rel="noreferrer" variant="subtle">Abrir Conta Azul</Button></Group>
    {!connected(selected) && <Alert color="orange">Este cliente precisa de uma conexão ativa com o Conta Azul. Dados anteriores, quando disponíveis, são históricos.</Alert>}
    {selected.management?.lastError && <Alert color="red">{selected.management.lastError}</Alert>}
    {!snapshot ? <Text c="dimmed">Clique em Atualizar este cliente para consultar os dados financeiros.</Text> : <>
    <Title order={4}>Contas e validação de saldo</Title>
    {snapshot.accountsError && <Alert color="orange">{snapshot.accountsError}</Alert>}{!snapshot.accountsComplete && <Alert color="orange">A lista de contas está incompleta. Atualize novamente antes de concluir a conferência.</Alert>}
    <SimpleGrid cols={{ base: 1, lg: 2 }}>{snapshot.accounts.map((account) => { const check = selected.management?.checkedAccounts[account.id], validation = balanceValidation(account, check), reconciliation = reconciliationStatus(check); return <Paper key={account.id} withBorder radius="md" p="lg"><Stack gap="sm"><Group justify="space-between"><div><Text fw={800}>{account.name}</Text><Text size="xs" c="dimmed">{account.bank}</Text></div><Badge color={color(validation.status)}>{labels[validation.status]}</Badge></Group><SimpleGrid cols={2}><div><Text size="xs" c="dimmed">Saldo Conta Azul</Text><Text fw={750}>{money(account.balance)}</Text><Text size="xs" c="dimmed">{when(account.queriedAt)}</Text></div><div><Text size="xs" c="dimmed">Saldo banco · informado</Text><Text fw={750}>{money(check?.bankBalance)}</Text><Text size="xs" c="dimmed">{when(check?.balanceAt)}</Text></div></SimpleGrid>{account.error && <Alert color="orange">{account.error}</Alert>}{validation.difference !== null && <Text fw={700} c={validation.status === "DIVERGENT" ? "red" : "green"}>Diferença CA − banco: {money(validation.difference)}</Text>}<Text size="sm">Última importação no CA: <b>{when(check?.lastImportAt)}</b></Text><Group gap="xs"><IconChecklist size={17} /><Text size="sm">Conciliação</Text><Badge size="sm" color={color(reconciliation)}>{labels[reconciliation]}</Badge></Group><Text size="sm">A pagar: {check?.pendingPayable ?? "Não conferido"} · A receber: {check?.pendingReceivable ?? "Não conferido"}</Text>{check && <Text size="xs" c="dimmed">Conferido por {check.checkedBy} em {when(check.checkedAt)}{check.note ? ` · ${check.note}` : ""}</Text>}{data.canEdit && <Button variant="default" onClick={() => edit(account)} disabled={Boolean(busy)}>Registrar conferência</Button>}</Stack></Paper>; })}</SimpleGrid>
    {!snapshot.accounts.length && <Text c="dimmed">Nenhuma conta disponível nesta consulta.</Text>}
    <Title order={4}>Títulos vencidos em aberto</Title><Text size="xs" c="dimmed">Consulta por vencimento: {snapshot.start} a {snapshot.end}. Exibe até 200 títulos por direção; totais consideram todas as páginas consultadas.</Text>
    <Tabs defaultValue="payable"><Tabs.List><Tabs.Tab value="payable">A pagar · {snapshot.payable.count}</Tabs.Tab><Tabs.Tab value="receivable">A receber · {snapshot.receivable.count}</Tabs.Tab></Tabs.List>{(["payable", "receivable"] as const).map((kind) => { const flow = snapshot[kind]; return <Tabs.Panel key={kind} value={kind} pt="md"><Stack gap="sm"><Text fw={800}>Total vencido: {money(flow.amount)}</Text>{(!flow.complete || flow.error) && <Alert color="orange" icon={<IconAlertTriangle size={17} />}>{flow.error || "Consulta parcial: existem páginas ainda não consultadas. O total pode aumentar."}</Alert>}<ScrollArea><Table miw={600}><Table.Thead><Table.Tr><Table.Th>Descrição</Table.Th><Table.Th>Contato</Table.Th><Table.Th>Vencimento</Table.Th><Table.Th>Em aberto</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{flow.items.map((item) => <Table.Tr key={item.id}><Table.Td>{item.description}</Table.Td><Table.Td>{item.contact || "—"}</Table.Td><Table.Td>{item.dueAt.split("-").reverse().join("/")}</Table.Td><Table.Td>{money(item.amount)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea>{flow.count > flow.items.length && <Text size="xs" c="dimmed">Mostrando {flow.items.length} de {flow.count} títulos consultados.</Text>}{!flow.items.length && <Text c="dimmed">{flow.complete && !flow.error ? "Nenhum título vencido em aberto nesta consulta." : "Dados indisponíveis nesta consulta."}</Text>}</Stack></Tabs.Panel>; })}</Tabs>
    </>}
    {data.canManage && <Paper withBorder p="md" radius="md"><Stack gap="xs"><Text fw={750}>Página do cliente no Notion</Text><Text size="sm" c="dimmed">Vincule a página deste cliente para a assistente consultar os acessos e informações da operação. Sem vínculo, a assistente tenta localizar uma única página com o nome exato do cliente.</Text><TextInput label="Link ou ID da página" placeholder="https://www.notion.so/..." value={pageLink} onChange={(event) => setPageLink(event.currentTarget.value)} /><Button w="fit-content" variant="light" loading={saving} onClick={() => void saveNotion()}>Salvar vínculo do Notion</Button></Stack></Paper>}
    </>}
    </Stack></Paper></div>
    <Modal opened={Boolean(editing)} onClose={() => !saving && setEditing(null)} title={`Conferência · ${editing?.name || ""}`} size="lg"><Stack><Text size="sm" c="dimmed">Copie os dados conferidos no banco e na tela de conciliação do CA. Deixe vazio o que não foi conferido; zero significa nenhuma pendência.</Text><NumberInput label="Saldo bancário" decimalScale={2} fixedDecimalScale value={form.bankBalance} onChange={(bankBalance) => setForm({ ...form, bankBalance })} /><TextInput type="datetime-local" label="Data e hora do saldo bancário · Brasília" value={form.balanceAt} onChange={(event) => setForm({ ...form, balanceAt: event.currentTarget.value })} /><TextInput type="datetime-local" label="Última importação do extrato no CA · Brasília" value={form.lastImportAt} onChange={(event) => setForm({ ...form, lastImportAt: event.currentTarget.value })} /><SimpleGrid cols={2}><NumberInput label="Conciliações pendentes · a pagar" min={0} allowDecimal={false} value={form.pendingPayable} onChange={(pendingPayable) => setForm({ ...form, pendingPayable })} /><NumberInput label="Conciliações pendentes · a receber" min={0} allowDecimal={false} value={form.pendingReceivable} onChange={(pendingReceivable) => setForm({ ...form, pendingReceivable })} /></SimpleGrid><Textarea label="Observações / referência da conferência" value={form.note} onChange={(event) => setForm({ ...form, note: event.currentTarget.value })} maxLength={1000} /><Button loading={saving} onClick={() => void saveCheck()}>Salvar conferência</Button></Stack></Modal>
  </Stack>;
}
