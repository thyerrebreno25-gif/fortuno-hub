"use client";
import {inheritedRoutineFamily} from "./routine-ownership";
import {paymentAgenda,reconciliation} from "./routine-policy";
import { useState } from "react";
import { Alert, Button, Group, Modal, MultiSelect, NumberInput, Select, SimpleGrid, Stack, Switch, Text, TextInput } from "@mantine/core";
import type { ConfiguredRoutine } from "./routine-filters";
import { routineEditSchema, type RoutineEdit } from "./edit-model";
import { notifications } from "@mantine/notifications";
import {routineHolidayBehavior,routineCalendarDescription} from "./routine-calendar";
type Member = { id: string; name: string | null; email: string };
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label, value) => ({ value: String(value), label }));
function initial(routine: ConfiguredRoutine): RoutineEdit {
  const data = (routine.recurrenceData || {}) as Partial<RoutineEdit["recurrenceData"]>;
  return { expectedUpdatedAt: routine.updatedAt, responsibleId: routine.responsibleId, team: routine.team, priority: (paymentAgenda(routine.process.name)?"HIGH":routine.priority) as RoutineEdit["priority"], notifyClient: !reconciliation(routine.process.name)&&routine.notifyClient !== false, auditEnabled: routine.auditEnabled === true, recurrenceType: routine.recurrenceType as RoutineEdit["recurrenceType"], recurrenceData: { startDate: data.startDate || routine.createdAt.slice(0, 10), endDate: data.endDate || null, dueTime: data.dueTime || "18:00", interval: data.interval || 1, dailyMode: data.dailyMode || "ALL_DAYS", weekdays: data.weekdays || [], monthDays: data.monthDays?.length ? data.monthDays : [Number((data.startDate || routine.createdAt).slice(8, 10))], holidayBehavior: "PREVIOUS_BUSINESS_DAY" } };
}
export function RoutineEditControl({ routine, members, teams, onChanged }: { routine: ConfiguredRoutine; members: Member[]; teams: string[]; onChanged: () => Promise<void> }) {
  const [opened, setOpened] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [form, setForm] = useState(() => initial(routine));
  const schedule = form.recurrenceData;
  const frequency=form.recurrenceType==="DAILY"&&schedule.interval===15?"FORTNIGHTLY":form.recurrenceType;
  const change = (patch: Partial<RoutineEdit["recurrenceData"]>) => setForm(current => {
    const old=current.recurrenceData,next={...old,...patch};
    if(patch.startDate&&/^\d{4}-\d{2}-\d{2}$/.test(patch.startDate)&&current.recurrenceType==="MONTHLY"&&old.monthDays.length===1&&old.monthDays[0]===Number(old.startDate.slice(-2)))next.monthDays=[Number(patch.startDate.slice(-2))];
    return {...current,recurrenceData:next};
  });
  async function save() {
    const parsed = routineEditSchema.safeParse(form);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || "Confira a programação."); return; }
    setBusy(true); setError("");
    try { const response = await fetch(`/api/operations/configurations/${routine.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível editar a rotina."); setOpened(false); await onChanged(); notifications.show({color:"teal",title:"Rotina atualizada",message:body.transferred?`${body.transferred} tarefa(s) transferida(s) para o novo responsável.${body.pausedTimers?` ${body.pausedTimers} cronômetro(s) pausado(s), com o tempo preservado.`:""}`:"Programação salva."}); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível editar a rotina."); } finally { setBusy(false); }
  }
  return <><Button size="compact-xs" variant="subtle" onClick={() => { setForm(initial(routine)); setError(""); setOpened(true); }}>Editar</Button><Modal opened={opened} onClose={() => { if (!busy) setOpened(false); }} title="Editar rotina" centered size="lg" closeOnClickOutside={!busy} closeOnEscape={!busy}><Stack>
    <div><Text fw={700}>{routine.client.name}</Text><Text c="dimmed" size="sm">{routine.process.name}</Text></div><Alert color="blue"><Text size="sm">Ao trocar o colaborador, todas as tarefas desta rotina passam para o novo responsável, inclusive antigas, iniciadas e encerradas. Tempos, anexos, comentários e checklist são mantidos. Cronômetros em andamento são pausados.</Text><Text size="sm" mt="xs">Alterações nos dias e horários continuam sendo aplicadas apenas às atividades de hoje em diante que ainda não tiveram execução.</Text></Alert>{error && <Alert color="red">{error}</Alert>}
    <SimpleGrid cols={{ base: 1, sm: 2 }}><Select disabled={Boolean(inheritedRoutineFamily(routine.process.name))} description={inheritedRoutineFamily(routine.process.name)?"Herdado da conciliação. Use Transferir rotina para alterar o responsável das rotinas vinculadas.":undefined} searchable clearable label="Colaborador" data={members.map(member => ({ value: member.id, label: member.name || member.email }))} value={form.responsibleId} onChange={responsibleId => setForm({ ...form, responsibleId })}/><Select searchable clearable label="Equipe" data={teams} value={form.team} onChange={team => setForm({ ...form, team })}/><Select disabled={paymentAgenda(routine.process.name)} label="Prioridade" data={[{ value: "LOW", label: "Baixa" }, { value: "MEDIUM", label: "Média" }, { value: "HIGH", label: "Alta" }, { value: "CRITICAL", label: "Crítica" }]} value={form.priority} onChange={priority => setForm({ ...form, priority: priority as RoutineEdit["priority"] })}/><Select label="Recorrência" data={[{ value: "ONCE", label: "Uma vez" }, { value: "DAILY", label: "Diária" }, { value: "WEEKLY", label: "Semanal" }, { value: "MONTHLY", label: "Mensal" }, { value: "FORTNIGHTLY", label: "Quinzenal · a cada 15 dias" }, { value: "CUSTOM", label: "Personalizada" }]} value={frequency} onChange={value => {
      if(!value)return;
      const fortnight=value==="FORTNIGHTLY";
      setForm({...form,recurrenceType:fortnight?"DAILY":value as RoutineEdit["recurrenceType"],recurrenceData:{...schedule,interval:fortnight?15:1,dailyMode:fortnight?"ALL_DAYS":schedule.dailyMode,monthDays:value==="MONTHLY"?[Number(schedule.startDate.slice(-2))]:schedule.monthDays}});
    }}/></SimpleGrid>
    {frequency === "DAILY" && <Select label="Dias considerados" value={schedule.dailyMode} onChange={value => change({ dailyMode: value as RoutineEdit["recurrenceData"]["dailyMode"] })} data={[{ value: "ALL_DAYS", label: "Todos os dias" }, { value: "BUSINESS_DAYS", label: "Dias úteis" }, { value: "CUSTOM_DAYS", label: "Dias escolhidos" }]}/>}
    {(["WEEKLY", "CUSTOM"].includes(form.recurrenceType) || form.recurrenceType === "DAILY" && schedule.dailyMode === "CUSTOM_DAYS") && <MultiSelect label="Dias da semana" data={weekdays} value={schedule.weekdays.map(String)} onChange={values => change({ weekdays: values.map(Number) })}/>}
    {form.recurrenceType === "MONTHLY" && <MultiSelect label="Dias fixos do mês" data={Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: `Dia ${index + 1}` }))} value={schedule.monthDays.map(String)} onChange={values => change({ monthDays: values.map(Number) })}/>}
    <SimpleGrid cols={2}><TextInput required type="date" label="Data de início" description="Define a referência da recorrência. O histórico e as atividades já iniciadas são mantidos." value={schedule.startDate} onChange={event => change({ startDate: event.currentTarget.value })}/><TextInput type="date" label="Fim opcional" value={schedule.endDate || ""} onChange={event => change({ endDate: event.currentTarget.value || null })}/><TextInput type="time" label="Horário limite (Brasília)" value={schedule.dueTime} onChange={event => change({ dueTime: event.currentTarget.value })}/><NumberInput label="Intervalo" min={1} max={365} disabled={["ONCE", "CUSTOM"].includes(form.recurrenceType)} value={schedule.interval} onChange={value => change({ interval: Number(value) })}/></SimpleGrid>
    <Select disabled label="Fins de semana e feriados" description={routineCalendarDescription(form.recurrenceType,schedule)} value={routineHolidayBehavior(form.recurrenceType,schedule)} data={[{ value: "PREVIOUS_BUSINESS_DAY", label: "Feriados: antecipar para dia útil" }, { value: "NEXT_BUSINESS_DAY", label: "Próximo dia útil" }]}/>
    <Switch disabled={reconciliation(routine.process.name)} label="Enviar e-mail ao concluir" checked={form.notifyClient} onChange={event => setForm({ ...form, notifyClient: event.currentTarget.checked })}/><Switch label="Auditoria habilitada" checked={form.auditEnabled} onChange={event => setForm({ ...form, auditEnabled: event.currentTarget.checked })}/><Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setOpened(false)}>Cancelar</Button><Button loading={busy} onClick={() => void save()}>Salvar programação</Button></Group>
  </Stack></Modal></>;
}
