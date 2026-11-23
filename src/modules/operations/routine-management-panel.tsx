"use client";
import { useMemo, useState } from "react";
import { ActionIcon, Alert, Badge, Button, Group, Loader, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { CollapsibleOperationFilters } from "./collapsible-filters";
import { duplicateRoutineIds, emptyRoutineFilters, filterConfiguredRoutines, type ConfiguredRoutine } from "./routine-filters";
import { routineScheduleLabel } from "./routine-schedule";
import {RoutineEditControl} from "./routine-edit-control";
import { canonicalTeam } from "./teams";

const dateLabel = (date: string) => date.slice(0, 10).split("-").reverse().join("/");
const priorityLabel: Record<string, string> = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta", CRITICAL: "Crítica" };
type Impact = { total: number; completed: number; running: number; fingerprint: string };
export function RoutineManagementPanel({ routines, canDelete, onChanged, members = [], teams = [] }: { routines: ConfiguredRoutine[]; canDelete: boolean; onChanged: () => Promise<void>; members?: {id:string;name:string|null;email:string}[]; teams?: string[] }) {
  const [filters, setFilters] = useState(emptyRoutineFilters);
  const [selected, setSelected] = useState<ConfiguredRoutine | null>(null), [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState(""), [confirmation, setConfirmation] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const duplicates = useMemo(() => duplicateRoutineIds(routines), [routines]);
  const filtered = useMemo(() => filterConfiguredRoutines(routines, filters, duplicates), [routines, filters, duplicates]);
  const options = (key: "client" | "process" | "responsible") => [...new Map(routines.flatMap(routine => {
    const value = routine[key];
    return value ? [[value.id, { value: value.id, label: value.name || ("email" in value ? value.email : "") }] as const] : [];
  })).values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const active = Object.entries(filters).filter(([, value]) => Boolean(value)).length;
  const invalidPeriod = Boolean(filters.from && filters.to && filters.from > filters.to);
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
    <CollapsibleOperationFilters title="Filtros das rotinas" summary={`${filtered.length} de ${routines.length} rotina(s)${active ? ` · ${active} filtro(s) ativo(s)` : " · todos os colaboradores e clientes"}`}>
      <Stack gap="sm"><SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Select clearable searchable label="Colaborador" placeholder="Todos" data={options("responsible")} value={filters.responsibleId || null} onChange={value => setFilters(current => ({ ...current, responsibleId: value || "" }))}/>
        <Select clearable searchable label="Cliente" placeholder="Todos" data={options("client")} value={filters.clientId || null} onChange={value => setFilters(current => ({ ...current, clientId: value || "" }))}/>
        <Select clearable searchable label="Processo" placeholder="Todos" data={options("process")} value={filters.processId || null} onChange={value => setFilters(current => ({ ...current, processId: value || "" }))}/>
      </SimpleGrid><SimpleGrid cols={{ base: 1, sm: 2 }}>
        <TextInput type="date" label="Vigência: de" value={filters.from} onChange={event => { const value = event.currentTarget.value; setFilters(current => ({ ...current, from: value })); }}/>
        <TextInput type="date" label="Vigência: até" value={filters.to} min={filters.from || undefined} error={invalidPeriod ? "A data final deve ser igual ou posterior à inicial." : undefined} onChange={event => { const value = event.currentTarget.value; setFilters(current => ({ ...current, to: value })); }}/>
      </SimpleGrid><Text size="xs" c="dimmed">Mostra rotinas vigentes em algum momento do período, inclusive as iniciadas antes dele.</Text>
      <Group justify="space-between"><Switch label="Somente possíveis duplicadas" checked={filters.duplicatesOnly} onChange={event => { const checked = event.currentTarget.checked; setFilters(current => ({ ...current, duplicatesOnly: checked })); }}/><Button variant="subtle" size="xs" disabled={!active} onClick={() => setFilters(emptyRoutineFilters)}>Limpar filtros</Button></Group></Stack>
    </CollapsibleOperationFilters>
    {filters.duplicatesOnly && <Alert color="yellow">As sinalizações comparam cliente, processo, colaborador, equipe e a mesma programação. Confira cada rotina antes de excluir.</Alert>}
    <Paper withBorder style={{ overflow: "hidden" }}><ScrollArea type="auto" scrollbarSize={8}><Table miw={1100} verticalSpacing="sm" horizontalSpacing="sm"><Table.Thead><Table.Tr>
      <Table.Th>Cliente</Table.Th><Table.Th>Processo</Table.Th><Table.Th>Colaborador</Table.Th><Table.Th>Equipe</Table.Th><Table.Th>Recorrência e vigência</Table.Th><Table.Th>Prioridade</Table.Th><Table.Th>Ações</Table.Th>
    </Table.Tr></Table.Thead><Table.Tbody>{!invalidPeriod && filtered.map(routine => {
      const schedule = (routine.recurrenceData || {}) as Record<string, string>;
      return <Table.Tr key={routine.id}><Table.Td><Text size="sm" fw={600}>{routine.client.name}</Text><Text size="xs" c="dimmed">Cluster {routine.client.cluster}</Text></Table.Td>
        <Table.Td><Text size="sm">{routine.process.name}</Text>{duplicates.has(routine.id) && <Badge size="xs" color="orange" variant="light">Possível duplicada</Badge>}</Table.Td>
        <Table.Td>{routine.responsible?.name || routine.responsible?.email || "Sem colaborador definido"}</Table.Td><Table.Td>{canonicalTeam(routine.team) || "—"}</Table.Td>
        <Table.Td><Text size="sm">{routineScheduleLabel(routine.recurrenceType, routine.recurrenceData)}</Text><Text size="xs" c="dimmed">{dateLabel(schedule.startDate || routine.createdAt)}{routine.recurrenceType === "ONCE" ? "" : schedule.endDate ? ` até ${dateLabel(schedule.endDate)}` : " · sem fim"}</Text></Table.Td>
        <Table.Td>{priorityLabel[routine.priority]}</Table.Td><Table.Td><Group gap="xs" wrap="nowrap">{canDelete&&<RoutineEditControl routine={routine} members={members} teams={teams} onChanged={onChanged}/ >}{canDelete && <ActionIcon color="red" variant="light" aria-label={`Excluir rotina ${routine.process.name} de ${routine.client.name}`} title="Excluir somente esta rotina" onClick={() => void preview(routine)}><IconTrash size={17}/></ActionIcon>}</Group></Table.Td>
      </Table.Tr>;
    })}</Table.Tbody></Table></ScrollArea>{(!filtered.length || invalidPeriod) && <Text p="xl" ta="center" c="dimmed">{invalidPeriod ? "Confira o período dos filtros." : "Nenhuma rotina para os filtros selecionados."}</Text>}</Paper>
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
