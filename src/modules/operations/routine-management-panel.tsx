"use client";
import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, Tooltip } from "@mantine/core";
import { IconTrash, IconPlus, IconSearch } from "@tabler/icons-react";
import { CollapsibleOperationFilters } from "./collapsible-filters";
import { duplicateRoutineIds, emptyRoutineFilters, filterConfiguredRoutines, type ConfiguredRoutine } from "./routine-filters";
import { routineScheduleLabel } from "./routine-schedule";
import {RoutineEditControl} from "./routine-edit-control";
import { canonicalTeam } from "./teams";

import {RoutineConfigureDialog} from "./routine-configure-dialog";
import {routineColumns,routineCellIndex,routineCellKey,type RoutineClient,type RoutineProcess,type RoutineColumn} from "./routine-matrix";
import styles from "./routine-matrix.module.css";

const dateLabel = (date: string) => date.slice(0, 10).split("-").reverse().join("/");
const priorityLabel: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };
type Impact = { total: number; completed: number; running: number; fingerprint: string };
export function RoutineManagementPanel({ routines, clients, processes, canDelete, onChanged, members = [], teams = [] }: { routines: ConfiguredRoutine[]; clients:RoutineClient[];processes:RoutineProcess[];canDelete: boolean; onChanged: () => Promise<void>; members?: {id:string;name:string|null;email:string}[]; teams?: string[] }) {
  const [filters, setFilters] = useState(emptyRoutineFilters);
  const [search,setSearch]=useState(""),[configure,setConfigure]=useState<{client:RoutineClient;column:RoutineColumn}|null>(null),[cell,setCell]=useState<{client:RoutineClient;column:RoutineColumn}|null>(null);
  const [sectionOpen,setSectionOpen]=useState(false),[sectionName,setSectionName]=useState(""),[sectionSteps,setSectionSteps]=useState(""),[sectionError,setSectionError]=useState(""),[sectionBusy,setSectionBusy]=useState(false);
  const columns=useMemo(()=>routineColumns([...processes,...routines.filter(r=>!processes.some(p=>p.id===r.processId)).map(r=>r.process)]),[processes,routines]);
  const [toggling,setToggling]=useState(false),[toggleError,setToggleError]=useState(""),[toggleResult,setToggleResult]=useState("");
  const [selected, setSelected] = useState<ConfiguredRoutine | null>(null), [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState(""), [confirmation, setConfirmation] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const duplicates = useMemo(() => duplicateRoutineIds(routines), [routines]);
  const filtered = useMemo(() => filterConfiguredRoutines(routines, filters, duplicates), [routines, filters, duplicates]);
  const index=useMemo(()=>routineCellIndex(routines,columns),[routines,columns]);
  const visibleColumns=columns.filter(c=>!filters.processId||c.processId===filters.processId||filtered.some(r=>r.processId===filters.processId&&index.get(routineCellKey(r.clientId,c.id))?.some(x=>x.id===r.id)));
  const visibleClients=clients.filter(client=>(!filters.clientId||client.id===filters.clientId)&&client.name.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))&&(!(filters.responsibleId||filters.processId||filters.from||filters.to||filters.duplicatesOnly)||filtered.some(r=>r.clientId===client.id)));
  async function addSection(){setSectionBusy(true);setSectionError("");try{const response=await fetch("/api/operations/processes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:sectionName,department:"Rotinas configuradas",notifyClient:false,checklist:sectionSteps.split("\n").filter(s=>s.trim()).map(title=>({title,mandatory:true}))})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível adicionar a seção.");await onChanged();setSectionOpen(false);setSectionName("");setSectionSteps("");}catch(cause){setSectionError(cause instanceof Error?cause.message:"Não foi possível adicionar a seção.");}finally{setSectionBusy(false);}}
  const active = Object.entries(filters).filter(([, value]) => Boolean(value)).length;
  const invalidPeriod = Boolean(filters.from && filters.to && filters.from > filters.to);
  async function uncheck(client:RoutineClient,column:RoutineColumn){
    const rows=index.get(routineCellKey(client.id,column.id))||[];if(toggling||!rows.length)return;setToggling(true);setToggleError("");setToggleResult("");
    try{const response=await fetch("/api/operations/configurations/uncheck",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({clientId:client.id,columnId:column.id,routines:rows.map(r=>({id:r.id,updatedAt:r.updatedAt}))})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível desmarcar a rotina.");await onChanged();setToggleResult(body.removed+" atividade(s) futura(s) não iniciada(s) retirada(s). Histórico, tarefas de hoje e atividades já iniciadas preservados.");}catch(cause){setToggleError(cause instanceof Error?cause.message:"Não foi possível desmarcar a rotina.");await onChanged();}finally{setToggling(false);}
  }
  async function preview(routine: ConfiguredRoutine) {
    setSelected(routine); setImpact(null); setReason(""); setConfirmation(""); setError(""); setBusy(true);
    try {
      const response = await fetch(`/api/operations/configurations/${encodeURIComponent(routine.id)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível conferir a rotina.");
      setImpact(body.impact);
    } catch (error) { setError(error instanceof Error ? error.message : "Erro ao conferir a rotina."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !impact || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/operations/configurations/${encodeURIComponent(selected.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, confirmation, fingerprint: impact.fingerprint }) });
      const body = await response.json();
      if (!response.ok) { if (response.status === 409) setImpact(null); throw new Error(body.error || "Não foi possível excluir a rotina."); }
      setSelected(null); await onChanged();
    } catch (error) { setError(error instanceof Error ? error.message : "Não foi possível excluir a rotina."); }
    finally { setBusy(false); }
  }
  return <Stack>
    <Group justify="space-between" align="flex-end"><div><Text fw={700} size="lg">Rotinas por cliente</Text><Text size="sm" c="dimmed">Marque para configurar e gerar atividades. Desmarque para retirar apenas as futuras não iniciadas.</Text></div><TextInput aria-label="Buscar cliente nas rotinas" placeholder="Buscar cliente" leftSection={<IconSearch size={17}/>} value={search} onChange={event=>setSearch(event.currentTarget.value)}/></Group>
    <CollapsibleOperationFilters title="Filtros das rotinas" summary={`${visibleClients.length} cliente(s) · ${filtered.length} de ${routines.length} rotina(s)${active ? ` · ${active} filtro(s) ativo(s)` : " · todos os colaboradores e clientes"}`}>
      <Stack gap="sm"><SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select clearable searchable label="Colaborador" placeholder="Todos" data={members.map(m=>({value:m.id,label:m.name||m.email}))} value={filters.responsibleId || null} onChange={value => setFilters(current => ({ ...current, responsibleId: value || "" }))}/>
        <Select clearable searchable label="Cliente" placeholder="Todos" data={clients.map(c=>({value:c.id,label:c.name}))} value={filters.clientId || null} onChange={value => setFilters(current => ({ ...current, clientId: value || "" }))}/>
        <Select clearable searchable label="Processo" placeholder="Todos" data={processes.map(p=>({value:p.id,label:p.name}))} value={filters.processId || null} onChange={value => setFilters(current => ({ ...current, processId: value || "" }))}/>
      </SimpleGrid><SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput type="date" label="Vigência: de" value={filters.from} onChange={event => { const value = event.currentTarget.value; setFilters(current => ({ ...current, from: value })); }}/>
        <TextInput type="date" label="Vigência: até" value={filters.to} min={filters.from || undefined} error={invalidPeriod ? "A data final deve ser igual ou posterior à inicial." : undefined} onChange={event => { const value = event.currentTarget.value; setFilters(current => ({ ...current, to: value })); }}/>
      </SimpleGrid><Text size="xs" c="dimmed">Mostra rotinas vigentes em algum momento do período, inclusive as iniciadas antes dele.</Text>
      <Group justify="space-between"><Switch label="Somente possíveis duplicadas" checked={filters.duplicatesOnly} onChange={event => { const checked = event.currentTarget.checked; setFilters(current => ({ ...current, duplicatesOnly: checked })); }}/><Button variant="subtle" size="xs" disabled={!active} onClick={() => setFilters(emptyRoutineFilters)}>Limpar filtros</Button></Group></Stack>
    </CollapsibleOperationFilters>
    {filters.duplicatesOnly && <Alert color="yellow">As sinalizações comparam cliente, processo, colaborador, equipe e a mesma programação. Confira cada rotina antes de excluir.</Alert>}
    {toggleError&&<Alert color="red">{toggleError}</Alert>}{toggleResult&&<Alert color="teal" withCloseButton onClose={()=>setToggleResult("")}>{toggleResult}</Alert>}
    <Paper withBorder radius="md" className={styles.frame}><div className={styles.scroller} role="region" aria-label="Tabela de rotinas por cliente" tabIndex={0}><Table className={styles.table} verticalSpacing="sm" horizontalSpacing="md"><Table.Thead><Table.Tr><Table.Th className={styles.clientHeading} scope="col">Cliente <Text size="sm" fw={400} c="dimmed">{visibleClients.length} de {clients.length} cadastrados</Text></Table.Th>{visibleColumns.map(column=><Table.Th key={column.id} scope="col" className={styles.heading}>{column.label}</Table.Th>)}<Table.Th className={styles.heading}>{canDelete?<Button variant="light" size="sm" leftSection={<IconPlus size={16}/>} onClick={()=>{setSectionError("");setSectionOpen(true);}}>Adicionar seção</Button>:"Outras seções"}</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{!invalidPeriod&&visibleClients.map(client=><Table.Tr key={client.id}><Table.Th scope="row" className={styles.clientCell}><Text fw={650} size="sm">{client.name}</Text><Group gap={6} mt={4}><Text size="xs" c="dimmed">Cluster {client.cluster}</Text>{client.active===false&&<Badge size="xs" color="gray">Inativo</Badge>}</Group></Table.Th>{visibleColumns.map(column=>{const entries=index.get(routineCellKey(client.id,column.id))||[];return <Table.Td key={column.id} className={styles.cell}><Checkbox mx="auto" mb={4} w="fit-content" aria-label={`${entries.length?"Desmarcar":"Marcar"} ${column.label} para ${client.name}`} checked={entries.length>0} disabled={!canDelete||toggling} onChange={event=>{if(event.currentTarget.checked)setConfigure({client,column});else void uncheck(client,column);}}/>{entries.length?<Tooltip label={entries.map(r=>r.responsible?.name||r.responsible?.email||"Sem responsável").join(" · ")}><button type="button" className={styles.configured} disabled={toggling} aria-label={`Ver ${entries.length} rotina(s) de ${column.label} para ${client.name}`} onClick={()=>setCell({client,column})}><span>{entries.length>1?entries.length+" rotinas":entries[0].responsible?.name||"Configurada"}</span>{entries.some(r=>duplicates.has(r.id))&&<Badge size="xs" color="orange">Duplicada?</Badge>}</button></Tooltip>:<Tooltip label={canDelete?`Configurar ${column.label}`:"Sem rotina configurada"}><button type="button" className={styles.empty} disabled={!canDelete||toggling} aria-label={`Configurar ${column.label} para ${client.name}`} onClick={()=>setConfigure({client,column})}><span>Configurar</span></button></Tooltip>}</Table.Td>;})}<Table.Td className={styles.cell}><Text size="sm" c="dimmed">—</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></div>{(!visibleClients.length||invalidPeriod)&&<Text p="xl" ta="center" c="dimmed">{invalidPeriod?"Confira o período dos filtros.":"Nenhum cliente para os filtros selecionados."}</Text>}</Paper>
    <Group justify="space-between"><Text size="sm" c="dimmed">{routines.length} rotina(s) configurada(s) · {clients.length} clientes cadastrados</Text><Text size="xs" c="dimmed">Role a tabela para consultar todas as seções.</Text></Group>
    {configure&&<RoutineConfigureDialog key={configure.client.id+configure.column.id} client={configure.client} column={configure.column} members={members} teams={teams} onClose={()=>setConfigure(null)} onChanged={onChanged}/>}
    <Modal opened={Boolean(cell)} onClose={()=>setCell(null)} title="Rotinas do cliente" size="lg" centered><Stack>{cell&&<><div><Text fw={700}>{cell.client.name}</Text><Text c="dimmed">{cell.column.label}</Text></div>{(index.get(routineCellKey(cell.client.id,cell.column.id))||[]).map(routine=>{const schedule=(routine.recurrenceData||{}) as Record<string,string>;return <Paper key={routine.id} withBorder p="md" radius="md"><Stack gap="xs"><Group justify="space-between"><Text fw={600}>{routine.responsible?.name||routine.responsible?.email||"Sem colaborador definido"}</Text>{duplicates.has(routine.id)&&<Badge color="orange">Possível duplicada</Badge>}</Group><Text size="sm">{routineScheduleLabel(routine.recurrenceType,routine.recurrenceData)}</Text><Text size="sm" c="dimmed">{dateLabel(schedule.startDate||routine.createdAt)}{schedule.endDate?` até ${dateLabel(schedule.endDate)}`:" · sem fim"} · {canonicalTeam(routine.team)||"Sem equipe"} · {priorityLabel[routine.priority]}</Text>{canDelete&&<Group justify="flex-end"><RoutineEditControl routine={routine} members={members} teams={teams} onChanged={onChanged}/><ActionIcon color="red" variant="light" aria-label={`Excluir rotina ${routine.process.name} de ${routine.client.name}`} onClick={()=>{setCell(null);void preview(routine);}}><IconTrash size={17}/></ActionIcon></Group>}</Stack></Paper>;})}{canDelete&&<Button variant="light" leftSection={<IconPlus size={16}/>} onClick={()=>{setConfigure(cell);setCell(null);}}>Adicionar outra programação</Button>}</>}</Stack></Modal>
    <Modal opened={sectionOpen} onClose={()=>!sectionBusy&&setSectionOpen(false)} title="Adicionar seção" centered><Stack><Text size="sm" c="dimmed">A nova seção aparece como coluna para todos os clientes. As rotinas serão criadas somente quando você configurar uma célula.</Text>{sectionError&&<Alert color="red">{sectionError}</Alert>}<TextInput label="Nome da seção" required maxLength={120} value={sectionName} onChange={event=>setSectionName(event.currentTarget.value)}/><Textarea label="Etapas da atividade (opcional)" description="Uma etapa por linha. Cada atividade gerada receberá este checklist." minRows={4} value={sectionSteps} onChange={event=>setSectionSteps(event.currentTarget.value)}/><Group justify="flex-end"><Button variant="default" disabled={sectionBusy} onClick={()=>setSectionOpen(false)}>Cancelar</Button><Button loading={sectionBusy} disabled={sectionName.trim().length<3} onClick={()=>void addSection()}>Adicionar seção</Button></Group></Stack></Modal>
    <Modal opened={Boolean(selected)} onClose={() => { if (!busy) setSelected(null); }} centered size="lg" title="Excluir esta rotina" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack>
      {selected && <Paper withBorder p="md"><Text fw={700}>{selected.client.name}</Text><Text>{selected.process.name}</Text><Text size="sm" c="dimmed">{selected.responsible?.name || selected.responsible?.email || "Sem colaborador definido"} · {routineScheduleLabel(selected.recurrenceType, selected.recurrenceData)}</Text></Paper>}
      {busy && !impact && <Loader size="sm"/>}{error && <Alert color="red">{error}</Alert>}
      {impact && <Alert color="red" title={`${impact.total} atividade(s) desta rotina serão removidas da agenda`}>
        Inclui {impact.completed} concluída(s) e {impact.running} em andamento. Cronômetros abertos serão encerrados. O histórico fica preservado internamente como excluído. As outras rotinas deste cliente permanecem na agenda.
      </Alert>}
      {!impact && !busy && selected && <Button variant="light" onClick={() => void preview(selected)}>Conferir novamente</Button>}
      <Textarea label="Justificativa" required value={reason} onChange={event => setReason(event.currentTarget.value)} placeholder="Ex.: rotina cadastrada em duplicidade" minRows={2}/>
      <TextInput label='Digite "EXCLUIR ROTINA" para confirmar' value={confirmation} onChange={event => setConfirmation(event.currentTarget.value)}/>
      <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setSelected(null)}>Cancelar</Button><Button color="red" loading={busy} disabled={!impact || reason.trim().length < 5 || confirmation.trim().toUpperCase() !== "EXCLUIR ROTINA"} onClick={() => void remove()}>Excluir somente esta rotina</Button></Group>
    </Stack></Modal>
  </Stack>;
}
