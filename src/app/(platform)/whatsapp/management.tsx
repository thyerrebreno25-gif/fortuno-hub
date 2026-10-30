"use client";
import { Alert, Badge, Button, Group, Loader, Pagination, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput } from "@mantine/core";
import { IconRefresh, IconSearch } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { WhatsAppManagementData } from "@/modules/whatsapp/management-types";
const labels: Record<string,string> = { NEW: "Na fila", IN_PROGRESS: "Em atendimento", WAITING_CUSTOMER: "Aguardando cliente", WAITING_INTERNAL: "Aguardando resposta", RESOLVED: "Finalizado" };
export function WhatsAppManagement({ onOpenTicket }: { onOpenTicket: (id: string) => void }) {
  const [data, setData] = useState<WhatsAppManagementData | null>(null);
  const [assignee, setAssignee] = useState("ALL");
  const [status, setStatus] = useState("OPEN");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let busy = false;
    const load = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true; setLoading(true);
      try {
        const params = new URLSearchParams({ assignee, status, search, page: String(page) });
        const response = await fetch('/api/whatsapp/management?' + params, { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar a gestão.");
        if (!controller.signal.aborted) { setData(body); setError(null); }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível carregar a gestão."); }
      finally { busy = false; if (!controller.signal.aborted) setLoading(false); }
    };
    const initial = setTimeout(() => void load(), 200);
    const timer = setInterval(() => void load(), 15000);
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [assignee, status, search, page, refresh]);
  const choose = (id: string) => { setAssignee(id); setPage(1); };
  return <Stack gap="md">
    <Group justify="space-between"><div><Text fw={850} size="xl">Gestão dos atendimentos</Text><Text size="sm" c="dimmed">{data ? 'Atualizado às ' + new Date(data.updatedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Carregando atendimentos'}</Text></div><Button variant="light" leftSection={<IconRefresh size={16}/>} loading={loading} onClick={() => setRefresh(value => value + 1)}>Atualizar</Button></Group>
    {error && <Alert color="red">{error}</Alert>}
    {!data && loading ? <Group><Loader size="sm"/><Text>Carregando a equipe…</Text></Group> : data && <>
      <SimpleGrid cols={{ base: 2, md: 4 }}>{[{label:'Todos os chamados',value:data.summary.total},{label:'Em aberto',value:data.summary.open},{label:'Sem responsável',value:data.summary.queue},{label:'Finalizados',value:data.summary.resolved}].map(metric=><Paper key={metric.label} withBorder p="md" radius="md"><Text size="sm" c="dimmed">{metric.label}</Text><Text fw={850} size="xl">{metric.value}</Text></Paper>)}</SimpleGrid>
      <Paper withBorder p="md" radius="md"><Text fw={800} mb="sm">Chamados por colaborador</Text><Table.ScrollContainer minWidth={500}><Table highlightOnHover><Table.Thead><Table.Tr><Table.Th>Colaborador</Table.Th><Table.Th>Em aberto</Table.Th><Table.Th>Finalizados</Table.Th><Table.Th>Total</Table.Th><Table.Th/></Table.Tr></Table.Thead><Table.Tbody>{data.agents.map(agent=><Table.Tr key={agent.id || 'QUEUE'} bg={assignee === (agent.id || 'QUEUE') ? 'var(--mantine-color-blue-light)' : undefined}><Table.Td><Text fw={650}>{agent.name}</Text></Table.Td><Table.Td><Badge color={agent.open ? 'orange' : 'gray'} variant="light">{agent.open}</Badge></Table.Td><Table.Td>{agent.resolved}</Table.Td><Table.Td>{agent.total}</Table.Td><Table.Td><Button size="compact-xs" variant="subtle" onClick={()=>choose(agent.id || 'QUEUE')}>Ver chamados</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer></Paper>
      <Paper withBorder p="md" radius="md"><Group justify="space-between" mb="md"><Text fw={800}>Conversas · {data.total}</Text><Group gap="sm"><Select aria-label="Colaborador" value={assignee} onChange={value=>choose(value || 'ALL')} data={[{value:'ALL',label:'Toda a equipe'},...data.agents.map(agent=>({value:agent.id || 'QUEUE',label:agent.name}))]} searchable/><Select aria-label="Situação dos chamados" value={status} onChange={value=>{setStatus(value || 'OPEN');setPage(1);}} data={[{value:'OPEN',label:'Em aberto'},{value:'RESOLVED',label:'Finalizados'},{value:'ALL',label:'Todos'}]}/><TextInput aria-label="Buscar conversa na gestão" placeholder="Buscar contato ou cliente" leftSection={<IconSearch size={16}/>} value={search} onChange={event=>{setSearch(event.currentTarget.value);setPage(1);}} maxLength={200}/></Group></Group>
        <Table.ScrollContainer minWidth={750}><Table highlightOnHover><Table.Thead><Table.Tr><Table.Th>Conversa</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Responsável</Table.Th><Table.Th>Situação</Table.Th><Table.Th>Última mensagem</Table.Th><Table.Th/></Table.Tr></Table.Thead><Table.Tbody>{data.tickets.map(ticket=><Table.Tr key={ticket.id}><Table.Td><Text size="sm" fw={700}>{ticket.senderName || ticket.subject}</Text><Text size="xs" c="dimmed">{ticket.senderEmail.replace(/^wa-contact:/,'+').replace(/^wa-group:/,'Grupo: ')}</Text></Table.Td><Table.Td>{ticket.client?.name || 'Sem cliente vinculado'}</Table.Td><Table.Td>{ticket.assignedTo?.name || ticket.assignedTo?.email || 'Sem responsável'}</Table.Td><Table.Td><Badge variant="light" color={ticket.status === 'RESOLVED' ? 'gray' : 'blue'}>{labels[ticket.status] || ticket.status}</Badge></Table.Td><Table.Td>{new Date(ticket.lastMessageAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</Table.Td><Table.Td><Button size="compact-xs" variant="light" onClick={()=>onOpenTicket(ticket.id)}>Abrir conversa</Button></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>
        {!data.tickets.length && <Text ta="center" c="dimmed" py="xl">Nenhum chamado encontrado com esses filtros.</Text>}
        {data.total > data.pageSize && <Group justify="center" mt="md"><Pagination total={Math.ceil(data.total/data.pageSize)} value={page} onChange={setPage}/></Group>}
      </Paper>
    </>}
  </Stack>;
}
