"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowRight, IconCheck, IconDeviceFloppy, IconFolder, IconPlus, IconSearch, IconSitemap } from "@tabler/icons-react";
import { GuidedEditor } from "./guided-editor";
import { GutEditor } from "./gut-editor";
import { FlowEditor } from "./flow-editor";
import { cloneForToBe, emptyMapping, mappingInputSchema, validationIssues, type Mapping, type MappingInput } from "./model";
import styles from "./mapping.module.css";

type Summary = Pick<Mapping, "id" | "title" | "clientId" | "owner" | "status" | "updatedAt" | "revision" | "client">;
type Bootstrap = { mappings: Summary[]; clients: Array<{ id: string; name: string }>; permissions: { canView: boolean; canCreate: boolean; canEdit: boolean }; aiConfigured: boolean };
const statuses: Record<string, string> = { DRAFT: "Rascunho", REVIEW: "Em revisão", VALIDATED: "Validado" };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a solicitação.");
  return result;
}
export function OperationalMappingPage() {
  const [tab, setTab] = useState("central");
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<MappingInput>(emptyMapping);
  const [saved, setSaved] = useState<{ id: string; revision: number; updatedAt: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [mode, setMode] = useState<"asIs" | "toBe">("asIs");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const canEdit = Boolean(saved ? bootstrap?.permissions.canEdit : bootstrap?.permissions.canCreate);
  const blocked = busy || !canEdit;
  const load = useCallback(async () => {
    try { setLoadError(""); setBootstrap(await request<Bootstrap>("/api/operational-mappings")); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "Falha ao carregar a central."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function change(next: MappingInput) { setDraft(next); setDirty(true); }
  function patch(patch: Partial<MappingInput>) { change({ ...draft, ...patch, status: "REVIEW" }); }
  function startNew(clientId: string | null = null) {
    if (dirty && !window.confirm("Há alterações não salvas. Descartá-las para criar outro mapeamento?")) return;
    setDraft({ ...emptyMapping(), clientId }); setSaved(null); setDirty(false); setMode("asIs"); setTab("create");
  }
  async function openMapping(id: string) {
    if (dirty && !window.confirm("Há alterações não salvas. Descartá-las para abrir outro mapeamento?")) return;
    setBusy(true);
    try {
      const { mapping } = await request<{ mapping: Mapping }>(`/api/operational-mappings?id=${encodeURIComponent(id)}`);
      const input = mappingInputSchema.parse(mapping);
      setDraft(input); setSaved({ id: mapping.id, revision: mapping.revision, updatedAt: mapping.updatedAt }); setDirty(false); setMode("asIs"); setTab(input.data.gut?.length && !input.data.asIs.nodes.length ? "gut" : "editor");
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  }
  function notifyError(error: unknown) { notifications.show({ color: "red", title: "Mapeamento operacional", message: error instanceof Error ? error.message : "Não foi possível concluir a ação." }); }
  async function save(status = draft.status) {
    const parsed = mappingInputSchema.safeParse({ ...draft, status });
    if (!parsed.success) { notifyError(new Error(parsed.error.issues[0].message)); return; }
    if (status === "VALIDATED") {
      const issues = [...validationIssues(draft.data.asIs), ...(draft.data.toBe.nodes.length ? validationIssues(draft.data.toBe) : [])];
      if (issues.length) { notifyError(new Error(issues[0])); return; }
    }
    setBusy(true);
    try {
      const { mapping } = await request<{ mapping: Mapping }>("/api/operational-mappings", { method: saved ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...parsed.data, ...(saved ? { id: saved.id, revision: saved.revision } : {}) }) });
      setDraft(parsed.data); setSaved({ id: mapping.id, revision: mapping.revision, updatedAt: mapping.updatedAt }); setDirty(false);
      setBootstrap((current) => current ? { ...current, mappings: [mapping, ...current.mappings.filter((item) => item.id !== mapping.id)] } : current);
      notifications.show({ color: "green", title: "Mapeamento salvo", message: status === "VALIDATED" ? "Etapas e conexões validadas." : "Seu trabalho está salvo e disponível na central." });
    } catch (error) { notifyError(error); }
    finally { setBusy(false); }
  }
  const filtered = (bootstrap?.mappings || []).filter((item) => (clientFilter === "all" || (clientFilter === "loose" ? !item.clientId : item.clientId === clientFilter)) && (!statusFilter || item.status === statusFilter) && `${item.title} ${item.client?.name || "avulso"} ${item.owner}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const graph = draft.data[mode];
  const reviewed = [...draft.data.asIs.nodes, ...draft.data.toBe.nodes].filter((node) => node.validated).length;
  const allNodes = draft.data.asIs.nodes.length + draft.data.toBe.nodes.length;
  const asIsReady = draft.data.asIs.nodes.length > 0 && draft.data.asIs.nodes.every((node) => node.validated) && !validationIssues(draft.data.asIs).length;
  return <div className={styles.page}>
    <Group justify="space-between"><div><Text size="xs" c="blue" fw={800} tt="uppercase">Operação · Processos</Text><Title order={2}>Mapeamento Operacional</Title></div><Button leftSection={<IconPlus size={17} />} disabled={busy || !bootstrap?.permissions.canCreate} onClick={() => startNew()}>Novo mapeamento</Button></Group>
    <nav className={styles.tabs} role="tablist" aria-label="Mapeamento operacional">{[{ id: "central", label: "Central de mapeamentos", icon: <IconFolder size={18} /> }, { id: "create", label: "Criação guiada", icon: <IconPlus size={18} /> }, { id: "editor", label: "Editor manual", icon: <IconSitemap size={18} /> }, { id: "gut", label: "Mapeamento GUT", icon: <IconCheck size={18} /> }].map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} disabled={busy || item.id !== "central" && !bootstrap} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}</nav>
    {loadError && <Alert color="red" title="Não foi possível carregar a central">{loadError}<Button variant="subtle" onClick={() => void load()}>Tentar novamente</Button></Alert>}
    {!bootstrap && !loadError && <Group><Loader size="sm" /><Text>Carregando clientes e mapeamentos...</Text></Group>}
    {bootstrap && tab === "central" && <>
      <SimpleGrid cols={{ base: 2, md: 4 }}>{[{ title: "Mapeamentos", value: bootstrap.mappings.length }, { title: "Clientes na central", value: bootstrap.clients.length }, { title: "Em revisão", value: bootstrap.mappings.filter((item) => item.status === "REVIEW").length }, { title: "Validados", value: bootstrap.mappings.filter((item) => item.status === "VALIDATED").length }].map((metric) => <Paper key={metric.title} withBorder p="lg" radius="lg"><Text size="sm" c="dimmed">{metric.title}</Text><Text fz={28} fw={800}>{metric.value}</Text></Paper>)}</SimpleGrid>
      <div className={styles.central}>
        <Paper withBorder p="sm" radius="lg" className={styles.clients}><Text size="xs" fw={800} c="dimmed" p="sm">CLIENTES E AVULSOS</Text>{[{ id: "all", name: "Todos os mapeamentos" }, { id: "loose", name: "Mapeamentos avulsos" }, ...bootstrap.clients].map((client) => <button className={styles.clientButton} aria-pressed={clientFilter === client.id} key={client.id} onClick={() => setClientFilter(client.id)}><span>{client.name}</span><Badge size="xs" variant="light">{bootstrap.mappings.filter((item) => client.id === "all" || (client.id === "loose" ? !item.clientId : item.clientId === client.id)).length}</Badge></button>)}</Paper>
        <Paper withBorder p="lg" radius="lg"><Stack><Group grow><TextInput aria-label="Buscar mapeamentos" placeholder="Buscar processo, cliente ou responsável" leftSection={<IconSearch size={16} />} value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><Select placeholder="Todos os status" aria-label="Status" clearable data={Object.entries(statuses).map(([value, label]) => ({ value, label }))} value={statusFilter} onChange={setStatusFilter} /></Group>
          {!filtered.length ? <Stack align="center" py={50}><IconSitemap size={42} color="#228be6" /><Text fw={750}>Um espaço para entender cada processo</Text><Text size="sm" c="dimmed" ta="center">Nenhum mapeamento encontrado. Comece pelo início do processo e acrescente cada operação.</Text><Button disabled={!bootstrap.permissions.canCreate} onClick={() => startNew(["all", "loose"].includes(clientFilter) ? null : clientFilter)}>Criar primeiro mapeamento</Button></Stack> : <Table.ScrollContainer minWidth={620}><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th>Processo</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Status</Table.Th><Table.Th>Atualização</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{filtered.map((item) => <Table.Tr key={item.id}><Table.Td><Text fw={700} size="sm">{item.title}</Text><Text size="xs" c="dimmed">{item.owner || "Responsável a definir"}</Text></Table.Td><Table.Td>{item.client?.name || "Avulso"}</Table.Td><Table.Td><Badge color={item.status === "VALIDATED" ? "green" : item.status === "REVIEW" ? "orange" : "gray"}>{statuses[item.status]}</Badge></Table.Td><Table.Td><Text size="xs">{new Date(item.updatedAt).toLocaleDateString("pt-BR")}</Text></Table.Td><Table.Td><Button size="xs" variant="light" disabled={busy} onClick={() => void openMapping(item.id)}>Abrir</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
          {bootstrap.mappings.length === 200 && <Text size="xs" c="dimmed">Exibindo os 200 mapeamentos atualizados mais recentemente.</Text>}
        </Stack></Paper>
      </div>
    </>}
    {bootstrap && tab !== "central" && <>
      <Group justify="space-between"><Group><Badge color={dirty ? "orange" : "green"}>{dirty ? "Alterações não salvas" : saved ? "Salvo" : "Novo rascunho"}</Badge><Text size="sm" c="dimmed">{saved ? `Revisão ${saved.revision} · ${new Date(saved.updatedAt).toLocaleString("pt-BR")}` : "Preencha o contexto e salve para continuar depois."}</Text></Group><Button leftSection={<IconDeviceFloppy size={16} />} loading={busy} disabled={!canEdit} onClick={() => void save()}>Salvar mapeamento</Button></Group>
      {tab === "create" && <Stack>
        <Paper withBorder radius="lg" p="lg"><Stack>
          <Title order={3}>Criação guiada do processo</Title>
          <Text c="dimmed" size="sm">Preencha os dados e construa a sequência abaixo. Você pode alternar entre a lista e o editor manual a qualquer momento.</Text>
          <TextInput label="Nome do processo" placeholder="Ex.: Contas a pagar" required value={draft.title} maxLength={160} disabled={blocked} onChange={(event) => patch({ title: event.currentTarget.value })} />
          <Group grow><Select label="Cliente" placeholder="Mapeamento avulso" clearable searchable data={bootstrap.clients.map((client) => ({ value: client.id, label: client.name }))} value={draft.clientId} disabled={blocked} onChange={(clientId) => patch({ clientId })} /><TextInput label="Responsável pelo mapeamento" value={draft.owner} maxLength={200} disabled={blocked} onChange={(event) => patch({ owner: event.currentTarget.value })} /></Group>
          <Group grow><Textarea label="Contexto do processo (opcional)" value={draft.description} maxLength={20000} disabled={blocked} onChange={(event) => patch({ description: event.currentTarget.value })} /><Textarea label="Objetivo da melhoria (opcional)" value={draft.objective} maxLength={3000} disabled={blocked} onChange={(event) => patch({ objective: event.currentTarget.value })} /></Group>
        </Stack></Paper>
        <Group justify="space-between"><Group><Button variant={mode === "asIs" ? "filled" : "light"} onClick={() => setMode("asIs")} disabled={busy}>AS IS · Atual</Button><Button variant={mode === "toBe" ? "filled" : "light"} onClick={() => setMode("toBe")} disabled={busy}>TO BE · Futuro</Button></Group><Button variant="light" rightSection={<IconArrowRight size={16} />} onClick={() => setTab("editor")}>Ver no editor manual</Button></Group>
        <GuidedEditor graph={graph} disabled={blocked} onChange={(next) => patch({ data: { ...draft.data, [mode]: next } })} />
      </Stack>}
      {tab === "gut" && <Stack>
        <Paper withBorder radius="lg" p="lg"><Stack><Title order={3}>Mapeamento GUT</Title><Text size="sm" c="dimmed">Avalie as atividades deste mapeamento e identifique onde agir primeiro.</Text>
          <TextInput label="Nome do processo" required value={draft.title} maxLength={160} disabled={blocked} onChange={(event) => patch({ title: event.currentTarget.value })} />
          <Group grow><Select label="Cliente" placeholder="Mapeamento avulso" clearable searchable data={bootstrap.clients.map((client) => ({ value: client.id, label: client.name }))} value={draft.clientId} disabled={blocked} onChange={(clientId) => patch({ clientId })} /><TextInput label="Responsável pelo mapeamento" value={draft.owner} maxLength={200} disabled={blocked} onChange={(event) => patch({ owner: event.currentTarget.value })} /></Group>
        </Stack></Paper>
        <GutEditor activities={draft.data.gut || []} disabled={blocked} onChange={(gut) => patch({ data: { ...draft.data, gut } })} />
      </Stack>}
      {tab === "editor" && <>
        <Group justify="space-between"><div><Title order={3}>{draft.title || "Novo mapeamento"}</Title><Text size="sm" c="dimmed">{bootstrap.clients.find((client) => client.id === draft.clientId)?.name || "Mapeamento avulso"} · {reviewed}/{allNodes} etapas validadas</Text></div><Group><Button variant={mode === "asIs" ? "filled" : "light"} onClick={() => setMode("asIs")} disabled={busy}>AS IS · Atual</Button><Button variant={mode === "toBe" ? "filled" : "light"} onClick={() => setMode("toBe")} disabled={busy}>TO BE · Futuro</Button></Group></Group>
        {mode === "toBe" && <Paper withBorder radius="lg" p="md"><Stack gap="sm"><Group><Button variant="light" disabled={blocked || !draft.data.asIs.nodes.length} onClick={() => { if (!graph.nodes.length || window.confirm("Substituir o TO BE atual por uma cópia do AS IS?")) patch({ data: { ...draft.data, toBe: cloneForToBe(draft.data.asIs) } }); }}>Usar AS IS como base</Button></Group><Textarea label="Melhorias propostas e resultados esperados" value={draft.data.improvements} maxLength={10000} disabled={blocked} autosize minRows={2} onChange={(event) => patch({ data: { ...draft.data, improvements: event.currentTarget.value } })} /></Stack></Paper>}
        <FlowEditor key={`${saved?.id || "new"}-${mode}`} graph={graph} disabled={blocked} onChange={(next) => patch({ data: { ...draft.data, [mode]: next } })} />
        <Paper withBorder p="lg" radius="lg"><Stack><Group justify="space-between"><Text fw={800}>Pontos a esclarecer</Text><Badge variant="light">Revisão humana</Badge></Group><Textarea aria-label="Pontos a esclarecer" description="Uma dúvida por linha. Edite ou remova os pontos conforme forem esclarecidos." value={draft.data.questions.join("\n")} disabled={blocked} autosize minRows={2} maxRows={10} onChange={(event) => patch({ data: { ...draft.data, questions: event.currentTarget.value.split("\n").slice(0, 30).map((line) => line.slice(0, 1000)) } })} /><Group justify="space-between"><Text size="sm" c="dimmed">Confira os responsáveis, as condições e o resultado de cada etapa.</Text><Button color="teal" leftSection={<IconCheck size={17} />} disabled={blocked || !allNodes || reviewed !== allNodes || !asIsReady} onClick={() => void save("VALIDATED")}>Validar e salvar mapeamento</Button></Group></Stack></Paper>
      </>}
    </>}

  </div>;
}
