"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Checkbox, Group, Paper, Progress, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { formatMeetingDate, type Meeting, type MeetingAction } from "./client";
import styles from "./meetings.module.css";

export function MeetingChecklist({ meeting, userId, canManage, editable, busy, onAdd, onEdit, onToggle, onDelete }: {
  meeting: Meeting; userId: string; canManage: boolean; editable: boolean; busy: boolean;
  onAdd: (responsibleId?: string) => void; onEdit: (item: MeetingAction) => void;
  onToggle: (item: MeetingAction, done: boolean) => void; onDelete: (item: MeetingAction) => void;
}) {
  const [query, setQuery] = useState(""), [owner, setOwner] = useState<string | null>(null), [status, setStatus] = useState<string | null>("pending");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const completed = meeting.actions.filter(item => item.completedAt).length;
  const overdue = (item: MeetingAction) => !item.completedAt && new Date(item.dueAt).getTime() < now;
  const visible = meeting.actions.filter(item => {
    const matchesStatus = status === "all" || (status === "completed" ? Boolean(item.completedAt) : status === "overdue" ? overdue(item) : !item.completedAt);
    return (!owner || item.responsibleId === owner) && matchesStatus && `${item.title} ${item.description} ${item.responsible.name || item.responsible.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  });
  const disabled = busy || !editable || meeting.status === "CANCELLED";
  return <Paper withBorder radius="lg" p="lg"><Stack>
    <Group justify="space-between"><div><Title order={4}>Tarefas da reunião</Title><Text size="sm" c="dimmed">Responsáveis e prazos vinculados à agenda.</Text></div><Button disabled={disabled} onClick={() => onAdd()}>Adicionar tarefa</Button></Group>
    <Group gap="xs"><Badge variant="light">{meeting.actions.length - completed} pendentes</Badge><Badge color="red" variant="light">{meeting.actions.filter(overdue).length} atrasadas</Badge><Badge color="green" variant="light">{completed} concluídas</Badge></Group>
    <Progress aria-label="Progresso das tarefas" value={meeting.actions.length ? completed / meeting.actions.length * 100 : 0} color="teal" /><Text size="xs" c="dimmed">{completed} de {meeting.actions.length} concluídas</Text>
    <div className={styles.taskFilters}><TextInput aria-label="Buscar tarefas" placeholder="Buscar tarefa ou detalhe" value={query} onChange={e => setQuery(e.currentTarget.value)} /><Select aria-label="Filtrar responsável" placeholder="Todos os responsáveis" clearable searchable data={meeting.participants.map(({user}) => ({value:user.id,label:user.name || user.email}))} value={owner} onChange={setOwner} /><Select aria-label="Filtrar situação das tarefas" allowDeselect={false} data={[{value:"pending",label:"Pendentes"},{value:"overdue",label:"Atrasadas"},{value:"completed",label:"Concluídas"},{value:"all",label:"Todas as tarefas"}]} value={status} onChange={setStatus} /></div>
    {!visible.length && <div className={styles.emptyTasks}><Text fw={650}>{meeting.actions.length ? "Nenhuma tarefa neste filtro" : "Nenhuma tarefa definida"}</Text><Text size="sm" c="dimmed">{meeting.actions.length ? "Altere os filtros para consultar outras tarefas." : "Adicione uma tarefa com responsável e prazo para acompanhar a entrega."}</Text></div>}
    {meeting.participants.map(({user}) => { const actions = visible.filter(item => item.responsibleId === user.id).sort((a,b) => Number(Boolean(a.completedAt))-Number(Boolean(b.completedAt)) || +new Date(a.dueAt)-+new Date(b.dueAt)); if (!actions.length) return null; return <Stack key={user.id} gap="xs"><Group justify="space-between"><Group gap="xs"><Text fw={750}>{user.name || user.email}</Text><Badge size="sm" variant="light">{actions.length}</Badge></Group>{(canManage || user.id === userId) && <Button variant="subtle" size="compact-xs" disabled={disabled} onClick={() => onAdd(user.id)}>Adicionar tarefa</Button>}</Group>
      {actions.map(item => <div key={item.id} className={styles.task} data-completed={Boolean(item.completedAt)} data-overdue={overdue(item)}><div className={styles.taskHeading}><Checkbox className={styles.taskCheckbox} label={item.title} checked={Boolean(item.completedAt)} disabled={disabled || (!canManage && item.responsibleId !== userId)} onChange={e => onToggle(item,e.currentTarget.checked)} /><Badge size="sm" color={item.completedAt ? "green" : overdue(item) ? "red" : "orange"}>{item.completedAt ? "Concluída" : overdue(item) ? "Atrasada" : "Pendente"}</Badge></div><Text size="xs" c={overdue(item) ? "red" : "dimmed"} mt="xs">Prazo: {formatMeetingDate(item.dueAt)}</Text>{item.description && <Text size="sm" mt="xs" className={styles.prose}>{item.description}</Text>}<Group mt="xs" gap="xs">{(canManage || item.responsibleId === userId) && <Button size="compact-xs" variant="light" disabled={disabled} onClick={() => onEdit(item)}>Editar tarefa</Button>}{canManage && <Button size="compact-xs" color="red" variant="subtle" disabled={disabled} onClick={() => onDelete(item)}>Excluir</Button>}</Group></div>)}
    </Stack>; })}
  </Stack></Paper>;
}
