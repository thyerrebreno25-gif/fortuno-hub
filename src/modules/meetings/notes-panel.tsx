"use client";
import {useState} from "react";
import {ActionIcon, Badge, Button, Group, Menu, Modal, Paper, Stack, Text, Textarea, Title, Tooltip} from "@mantine/core";
import {IconDots, IconEdit, IconMoodSmile, IconTrash} from "@tabler/icons-react";
import {notifications} from "@mantine/notifications";
import {formatMeetingDate, jsonRequest, meetingRequest, type Meeting} from "./client";
import {canDeleteNote, canEditNote, noteEmojis, noteReactions} from "./note-model";
import styles from "./meetings.module.css";
type Note = Meeting["contributions"][number];
export function MeetingNotesPanel({meeting, userId, canManage, editable, onDraftChange, onChanged}: {meeting: Meeting; userId: string; canManage: boolean; editable: boolean; onDraftChange: (pending: boolean) => void; onChanged: () => Promise<void>}) {
  const [draft, setDraft] = useState(""), [editing, setEditing] = useState<Note | null>(null), [body, setBody] = useState(""), [removing, setRemoving] = useState<Note | null>(null), [busy, setBusy] = useState(false);
  const writable = editable && meeting.status !== "CANCELLED";
  async function mutate(method: string, payload: object, after?: () => void) {
    setBusy(true);
    try {await meetingRequest("/api/meetings/notes", jsonRequest(method, {meetingId: meeting.id, ...payload})); after?.(); await onChanged();}
    catch (cause) {notifications.show({color: "red", message: cause instanceof Error ? cause.message : "Não foi possível atualizar a nota."}); await onChanged().catch(() => {});}
    finally {setBusy(false);}
  }
  return <Paper withBorder radius="lg" p="lg"><Stack>
    <div><Title order={4}>Notas da equipe</Title><Text size="xs" c="dimmed">Observações, decisões e reações dos participantes.</Text></div>
    {!meeting.contributions.length && <Text size="sm" c="dimmed">Nenhuma nota registrada nesta reunião.</Text>}
    {meeting.contributions.map(item => {
      const reactions = noteReactions(item.reactions);
      return <div key={item.id} className={styles.note}>
        <Group justify="space-between" align="flex-start" wrap="nowrap"><div style={{minWidth: 0}}><Text size="sm" fw={700}>{item.author.name || item.author.email}</Text><Text size="xs" c="dimmed">{formatMeetingDate(item.createdAt)}{item.editedAt ? " · editada" : ""}</Text></div>
          <Group gap={4} wrap="nowrap">
            {writable && <Menu position="bottom-end" withinPortal><Menu.Target><Tooltip label="Reagir à nota"><ActionIcon aria-label="Reagir à nota" variant="subtle" disabled={busy}><IconMoodSmile size={17}/></ActionIcon></Tooltip></Menu.Target><Menu.Dropdown><Group gap={3} p={4}>{noteEmojis.map(emoji => <ActionIcon key={emoji} aria-label={`Reagir com ${emoji}`} variant={reactions[userId] === emoji ? "light" : "subtle"} onClick={() => void mutate("PATCH", {id: item.id, action: "react", emoji})}>{emoji}</ActionIcon>)}</Group></Menu.Dropdown></Menu>}
            {writable && canDeleteNote(item.authorId, userId, canManage) && <Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon aria-label="Opções da nota" variant="subtle" color="gray" disabled={busy}><IconDots size={17}/></ActionIcon></Menu.Target><Menu.Dropdown>{canEditNote(item.authorId, userId) && <Menu.Item leftSection={<IconEdit size={15}/>} onClick={() => {setEditing(item); setBody(item.body);}}>Editar nota</Menu.Item>}<Menu.Item color="red" leftSection={<IconTrash size={15}/>} onClick={() => setRemoving(item)}>Excluir nota</Menu.Item></Menu.Dropdown></Menu>}
          </Group>
        </Group>
        <Text size="sm" mt="xs" className={styles.prose}>{item.body}</Text>
        <Group gap={5} mt="xs">{noteEmojis.map(emoji => {const people = Object.entries(reactions).filter(([, value]) => value === emoji); if (!people.length) return null; const names = people.map(([id]) => meeting.participants.find(person => person.userId === id)?.user.name || (id === item.authorId ? item.author.name : "Participante")).join(", "); return <Tooltip label={names} key={emoji}><Button size="compact-xs" variant={reactions[userId] === emoji ? "light" : "default"} disabled={!writable || busy} aria-label={`${emoji}: ${people.length} reações. ${names}`} onClick={() => void mutate("PATCH", {id: item.id, action: "react", emoji})}>{emoji} <Badge ml={5} size="xs" variant="transparent">{people.length}</Badge></Button></Tooltip>;})}</Group>
      </div>;
    })}
    {writable && <><Textarea label="Adicionar uma nota" value={draft} maxLength={10000} autosize minRows={2} onChange={event => {setDraft(event.currentTarget.value); onDraftChange(Boolean(event.currentTarget.value.trim()));}}/><Button size="xs" w="fit-content" loading={busy} disabled={!draft.trim()} onClick={() => void mutate("POST", {body: draft}, () => {setDraft(""); onDraftChange(false);})}>Registrar nota</Button></>}
    <Modal opened={!!editing} onClose={() => {if (!busy) setEditing(null);}} title="Editar nota" centered><Stack><Textarea label="Nota" value={body} maxLength={10000} minRows={4} autosize onChange={event => setBody(event.currentTarget.value)}/><Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setEditing(null)}>Cancelar</Button><Button loading={busy} disabled={!body.trim()} onClick={() => editing && void mutate("PATCH", {id: editing.id, revision: editing.revision, body}, () => setEditing(null))}>Salvar alteração</Button></Group></Stack></Modal>
    <Modal opened={!!removing} onClose={() => {if (!busy) setRemoving(null);}} title="Excluir nota" centered><Stack><Text size="sm">Excluir esta nota e suas reações da reunião?</Text><Text size="sm" c="dimmed" lineClamp={3}>{removing?.body}</Text><Group justify="flex-end"><Button variant="default" disabled={busy} onClick={() => setRemoving(null)}>Cancelar</Button><Button color="red" loading={busy} onClick={() => removing && void mutate("DELETE", {id: removing.id, revision: removing.revision}, () => setRemoving(null))}>Excluir nota</Button></Group></Stack></Modal>
  </Stack></Paper>;
}
