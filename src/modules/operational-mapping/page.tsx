"use client";
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowRight, IconCheck, IconDeviceFloppy, IconFolder, IconPlus, IconSearch, IconSitemap, IconSparkles } from "@tabler/icons-react";
import { FlowEditor } from "./flow-editor";
import { cloneForToBe, emptyMapping, mappingInputSchema, validationIssues, type FlowGraph, type Mapping, type MappingInput } from "./model";
import styles from "./mapping.module.css";

type Summary = Pick<Mapping, "id" | "title" | "clientId" | "owner" | "status" | "updatedAt" | "revision" | "client">;
type Bootstrap = { mappings: Summary[]; clients: Array<{ id: string; name: string }>; permissions: { canView: boolean; canCreate: boolean; canEdit: boolean }; aiConfigured: boolean };
type Proposal = { graph: FlowGraph; questions: string[]; improvements: string; mode: "asIs" | "toBe" };
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
  const [proposal, setProposal] = useState<Proposal | null>(null);
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
      setDraft(input); setSaved({ id: mapping.id, revision: mapping.revision, updatedAt: mapping.updatedAt }); setDirty(false); setMode("asIs"); setTab("editor");
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
  async function organize(stage: "asIs" | "toBe") {
    if (draft.title.trim().length < 3 || draft.description.trim().length < 30) { notifyError(new Error("Preencha o nome e descreva o processo atual com pelo menos 30 caracteres.")); setTab("create"); return; }
    setBusy(true);
    try { const result = await request<Omit<Proposal, "mode">>("/api/operational-mappings/organize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: draft.clientId, title: draft.title, description: draft.description, objective: draft.objective, mode: stage, current: draft.data.asIs }) }); setProposal({ ...result, mode: stage }); }
    catch (error) { notifyError(error); }
    finally { setBusy(false); }
  }
  function applyProposal() {
    if (!proposal) return;
    patch({ data: { ...draft.data, [proposal.mode]: proposal.graph, questions: [...new Set([...draft.data.questions, ...proposal.questions])].slice(0, 30), improvements: proposal.mode === "toBe" ? proposal.improvements : draft.data.improvements } });
    setMode(proposal.mode); setTab("editor"); setProposal(null);
  }
  const filtered = (bootstrap?.mappings || []).filter((item) => (clientFilter === "all" || (clientFilter === "loose" ? !item.clientId : item.clientId === clientFilter)) && (!statusFilter || item.status === statusFilter) && `${item.title} ${item.client?.name || "avulso"} ${item.owner}`.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  const graph = draft.data[mode];
  const reviewed = [...draft.data.asIs.nodes, ...draft.data.toBe.nodes].filter((node) => node.validated).length;
  const allNodes = draft.data.asIs.nodes.length + draft.data.toBe.nodes.length;
  const asIsReady = draft.data.asIs.nodes.length > 0 && draft.data.asIs.nodes.every((node) => node.validated) && !validationIssues(draft.data.asIs).length;
  return <div className={styles.page}>
    <Group justify="space-between"><div><Text size="xs" c="blue" fw={800} tt="uppercase">Operação · Processos</Text><Title order={2}>Mapeamento Operacional</Title><Text c="dimmed" size="sm">Entenda como funciona hoje. Desenhe como pode funcionar amanhã.</Text></div><Button leftSection={<IconPlus size={17} />} disabled={busy || !bootstrap?.permissions.canCreate} onClick={() => startNew()}>Novo mapeamento</Button></Group>
    <nav className={styles.tabs} role="tablist" aria-label="Mapeamento operacional">{[{ id: "central", label: "Central de mapeamentos", icon: <IconFolder size={18} /> }, { id: "create", label: "Criação e contexto", icon: <IconPlus size={18} /> }, { id: "editor", label: "Editor do mapeamento", icon: <IconSitemap size={18} /> }].map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} disabled={busy || item.id !== "central" && !bootstrap} onClick={() => setTab(item.id)}>{item.icon}{item.label}</button>)}</nav>
    {loadError && <Alert color="red" title="Não foi possível carregar a central">{loadError}<Button variant="subtle" onClick={() => void load()}>Tentar novamente</Button></Alert>}
    {!bootstrap && !loadError && <Group><Loader size="sm" /><Text>Carregando clientes e mapeamentos...</Text></Group>}
    {bootstrap && tab === "central" && <>
      <SimpleGrid cols={{ base: 2, md: 4 }}>{[{ title: "Mapeamentos", value: bootstrap.mappings.length }, { title: "Clientes na central", value: bootstrap.clients.length }, { title: "Em revisão", value: bootstrap.mappings.filter((item) => item.status === "REVIEW").length }, { title: "Validados", value: bootstrap.mappings.filter((item) => item.status === "VALIDATED").length }].map((metric) => <Paper key={metric.title} withBorder p="lg" radius="lg"><Text size="sm" c="dimmed">{metric.title}</Text><Text fz={28} fw={800}>{metric.value}</Text></Paper>)}</SimpleGrid>
      <div className={styles.central}>
        <Paper withBorder p="sm" radius="lg" className={styles.clients}><Text size="xs" fw={800} c="dimmed" p="sm">CLIENTES E AVULSOS</Text>{[{ id: "all", name: "Todos os mapeamentos" }, { id: "loose", name: "Mapeamentos avulsos" }, ...bootstrap.clients].map((client) => <button className={styles.clientButton} aria-pressed={clientFilter === client.id} key={client.id} onClick={() => setClientFilter(client.id)}><span>{client.name}</span><Badge size="xs" variant="light">{bootstrap.mappings.filter((item) => client.id === "all" || (client.id === "loose" ? !item.clientId : item.clientId === client.id)).length}</Badge></button>)}</Paper>
        <Paper withBorder p="lg" radius="lg"><Stack><Group grow><TextInput aria-label="Buscar mapeamentos" placeholder="Buscar processo, cliente ou responsável" leftSection={<IconSearch size={16} />} value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><Select placeholder="Todos os status" aria-label="Status" clearable data={Object.entries(statuses).map(([value, label]) => ({ value, label }))} value={statusFilter} onChange={setStatusFilter} /></Group>
          {!filtered.length ? <Stack align="center" py={50}><IconSitemap size={42} color="#228be6" /><Text fw={750}>Um espaço para entender cada processo</Text><Text size="sm" c="dimmed" ta="center">Nenhum mapeamento encontrado. Comece pelo relato de como o trabalho acontece hoje.</Text><Button disabled={!bootstrap.permissions.canCreate} onClick={() => startNew(["all", "loose"].includes(clientFilter) ? null : clientFilter)}>Criar primeiro mapeamento</Button></Stack> : <Table.ScrollContainer minWidth={620}><Table verticalSpacing="md"><Table.Thead><Table.Tr><Table.Th>Processo</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Status</Table.Th><Table.Th>Atualização</Table.Th><Table.Th /></Table.Tr></Table.Thead><Table.Tbody>{filtered.map((item) => <Table.Tr key={item.id}><Table.Td><Text fw={700} size="sm">{item.title}</Text><Text size="xs" c="dimmed">{item.owner || "Responsável a definir"}</Text></Table.Td><Table.Td>{item.client?.name || "Avulso"}</Table.Td><Table.Td><Badge color={item.status === "VALIDATED" ? "green" : item.status === "REVIEW" ? "orange" : "gray"}>{statuses[item.status]}</Badge></Table.Td><Table.Td><Text size="xs">{new Date(item.updatedAt).toLocaleDateString("pt-BR")}</Text></Table.Td><Table.Td><Button size="xs" variant="light" disabled={busy} onClick={() => void openMapping(item.id)}>Abrir</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
          {bootstrap.mappings.length === 200 && <Text size="xs" c="dimmed">Exibindo os 200 mapeamentos atualizados mais recentemente.</Text>}
        </Stack></Paper>
      </div>
    </>}
    {bootstrap && tab !== "central" && <>
      <Group justify="space-between"><Group><Badge color={dirty ? "orange" : "green"}>{dirty ? "Alterações não salvas" : saved ? "Salvo" : "Novo rascunho"}</Badge><Text size="sm" c="dimmed">{saved ? `Revisão ${saved.revision} · ${new Date(saved.updatedAt).toLocaleString("pt-BR")}` : "Preencha o contexto e salve para continuar depois."}</Text></Group><Button leftSection={<IconDeviceFloppy size={16} />} loading={busy} disabled={!canEdit} onClick={() => void save()}>Salvar mapeamento</Button></Group>
      {tab === "create" && <div className={styles.form}>
        <Paper withBorder radius="lg" p="xl"><Stack gap="lg"><div><Title order={3}>Conte como o processo funciona</Title><Text size="sm" c="dimmed">Descreva o dia a dia com suas palavras. Depois organize e valide cada etapa.</Text></div>
          <TextInput label="Nome do processo" placeholder="Ex.: Contas a pagar — da solicitação ao pagamento" required value={draft.title} maxLength={160} disabled={blocked} onChange={(event) => patch({ title: event.currentTarget.value })} />
          <Group grow><Select label="Cliente" placeholder="Mapeamento avulso" clearable searchable data={bootstrap.clients.map((client) => ({ value: client.id, label: client.name }))} value={draft.clientId} disabled={blocked} onChange={(clientId) => patch({ clientId })} /><TextInput label="Responsável pelo mapeamento" placeholder="Pessoa ou equipe" value={draft.owner} maxLength={200} disabled={blocked} onChange={(event) => patch({ owner: event.currentTarget.value })} /></Group>
          <Textarea label="Processo atual · AS IS" description="O que inicia o processo? Quem faz cada atividade? Onde entram decisões, aprovações, retrabalho e exceções?" placeholder="Hoje o cliente envia as notas por WhatsApp. O analista confere os documentos, registra no sistema e encaminha ao gestor para aprovação..." autosize minRows={8} maxRows={20} maxLength={20000} value={draft.description} disabled={blocked} onChange={(event) => patch({ description: event.currentTarget.value })} />
          <Textarea label="Objetivo da melhoria · TO BE" placeholder="Ex.: reduzir retrabalho, definir responsáveis e padronizar a aprovação." autosize minRows={3} maxLength={3000} value={draft.objective} disabled={blocked} onChange={(event) => patch({ objective: event.currentTarget.value })} />
          {!bootstrap.aiConfigured && <Alert color="orange">A IA não está configurada neste ambiente. Você pode criar as etapas manualmente no editor.</Alert>}
          <Group><Button leftSection={<IconSparkles size={17} />} loading={busy} disabled={!canEdit || !bootstrap.aiConfigured} onClick={() => void organize("asIs")}>Organizar AS IS com IA</Button><Button variant="light" rightSection={<IconArrowRight size={16} />} disabled={busy} onClick={() => setTab("editor")}>Montar manualmente</Button></Group>
        </Stack></Paper>
        <Stack><Paper className={styles.hero}><Text size="xs" fw={800} c="blue">DO RELATO AO PROCESSO</Text><Title order={3} mt="sm">Clareza antes da mudança.</Title><Stack mt="lg" gap="lg">{["01 · Descreva a rotina atual", "02 · Organize com inteligência", "03 · Revise e valide as etapas", "04 · Desenhe o processo futuro"].map((text) => <Text key={text} fw={650} size="sm">{text}</Text>)}</Stack></Paper><Paper withBorder radius="lg" p="lg"><Text fw={700}>O que vale incluir?</Text><Text size="sm" c="dimmed" mt="sm">Responsáveis, documentos recebidos, sistemas utilizados, prazos, aprovações e situações em que o trabalho volta para uma etapa anterior.</Text></Paper></Stack>
      </div>}
      {tab === "editor" && <>
        <Group justify="space-between"><div><Title order={3}>{draft.title || "Novo mapeamento"}</Title><Text size="sm" c="dimmed">{bootstrap.clients.find((client) => client.id === draft.clientId)?.name || "Mapeamento avulso"} · {reviewed}/{allNodes} etapas validadas</Text></div><Group><Button variant={mode === "asIs" ? "filled" : "light"} onClick={() => setMode("asIs")} disabled={busy}>AS IS · Atual</Button><Button variant={mode === "toBe" ? "filled" : "light"} onClick={() => setMode("toBe")} disabled={busy}>TO BE · Futuro</Button></Group></Group>
        {mode === "toBe" && <Paper withBorder radius="lg" p="md"><Stack gap="sm"><Group><Button variant="light" disabled={blocked || !draft.data.asIs.nodes.length} onClick={() => { if (!graph.nodes.length || window.confirm("Substituir o TO BE atual por uma cópia do AS IS?")) patch({ data: { ...draft.data, toBe: cloneForToBe(draft.data.asIs) } }); }}>Usar AS IS como base</Button><Button leftSection={<IconSparkles size={16} />} loading={busy} disabled={!canEdit || !bootstrap.aiConfigured || !asIsReady} onClick={() => void organize("toBe")}>Sugerir melhorias com IA</Button></Group>{!asIsReady && <Text size="xs" c="dimmed">Revise as conexões e valide as etapas do AS IS para solicitar a proposta de TO BE.</Text>}<Textarea label="Melhorias propostas e resultados esperados" value={draft.data.improvements} maxLength={10000} disabled={blocked} autosize minRows={2} onChange={(event) => patch({ data: { ...draft.data, improvements: event.currentTarget.value } })} /></Stack></Paper>}
        <FlowEditor key={`${saved?.id || "new"}-${mode}`} graph={graph} disabled={blocked} onChange={(next) => patch({ data: { ...draft.data, [mode]: next } })} />
        <Paper withBorder p="lg" radius="lg"><Stack><Group justify="space-between"><Text fw={800}>Pontos a esclarecer</Text><Badge variant="light">Revisão humana</Badge></Group><Textarea aria-label="Pontos a esclarecer" description="Uma dúvida por linha. Edite ou remova os pontos conforme forem esclarecidos." value={draft.data.questions.join("\n")} disabled={blocked} autosize minRows={2} maxRows={10} onChange={(event) => patch({ data: { ...draft.data, questions: event.currentTarget.value.split("\n").slice(0, 30).map((line) => line.slice(0, 1000)) } })} /><Group justify="space-between"><Text size="sm" c="dimmed">Confira os responsáveis, as condições e o resultado de cada etapa.</Text><Button color="teal" leftSection={<IconCheck size={17} />} disabled={blocked || !allNodes || reviewed !== allNodes || !asIsReady} onClick={() => void save("VALIDATED")}>Validar e salvar mapeamento</Button></Group></Stack></Paper>
      </>}
    </>}
    <Modal opened={!!proposal} onClose={() => setProposal(null)} title="Proposta organizada pela IA" size="xl" centered>
      {proposal && <Stack><Alert color="blue">Revise antes de aplicar. As etapas são sugestões e precisam de validação. Aplicar substitui somente o fluxo {proposal.mode === "asIs" ? "AS IS" : "TO BE"} atual.</Alert>{proposal.graph.nodes.map((node, index) => <Paper withBorder p="sm" radius="md" key={node.id}><Text fw={700}>{index + 1}. {node.title}</Text><Text size="sm">{node.description}</Text><Text size="xs" c="dimmed">{node.owner || "Responsável a definir"}{node.pain ? ` · Atenção: ${node.pain}` : ""}</Text></Paper>)}{proposal.questions.length > 0 && <Alert color="orange" title="A confirmar"><ul>{proposal.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></Alert>}<Group justify="flex-end"><Button variant="default" onClick={() => setProposal(null)}>Manter meu fluxo</Button><Button onClick={applyProposal}>Aplicar e revisar no editor</Button></Group></Stack>}
    </Modal>
  </div>;
}
