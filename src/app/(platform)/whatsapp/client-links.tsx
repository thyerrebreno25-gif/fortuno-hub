"use client";
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Progress, SegmentedControl, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import type { ClientLink, ClientLinkCoverage } from "@/modules/whatsapp/client-links";
import { WhatsAppLinkClientPicker } from "./link-client-picker";
export function WhatsAppClientLinks({ onOpenTicket, canEdit }: { onOpenTicket: (id: string) => void; canEdit: boolean }) {
  const [data, setData] = useState<ClientLinkCoverage | null>(null), [error, setError] = useState<string | null>(null), [opened, setOpened] = useState(false), [filter, setFilter] = useState("ALL"), [search, setSearch] = useState("");
  const [linkTarget, setLinkTarget] = useState<{ id: string; name: string } | null>(null), [refresh, setRefresh] = useState(0), [success, setSuccess] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  async function remove(clientId: string, link: ClientLink) {
    if (removing) return; setRemoving(clientId + link.kind + link.externalId); setError(null);
    try {
      const response = await fetch("/api/whatsapp/client-links", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, kind: link.kind, externalId: link.externalId }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível remover o vínculo.");
      setSuccess("Vínculo de " + link.name + " removido. A conversa e o histórico foram preservados."); setRefresh(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível remover o vínculo."); }
    finally { setRemoving(null); }
  }
  useEffect(() => {
    const controller = new AbortController(); let busy = false;
    const load = async () => {
      if (busy || document.hidden) return; busy = true;
      try { const response = await fetch("/api/whatsapp/client-links", { cache: "no-store", signal: controller.signal }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível consultar os vínculos."); if (!controller.signal.aborted) { setData(body); setError(null); } }
      catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Não foi possível consultar os vínculos."); } finally { busy = false; }
    };
    void load(); const timer = setInterval(() => void load(), 60000); const visible = () => { if (!document.hidden) void load(); }; document.addEventListener("visibilitychange", visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  const rows = data?.clients.filter(client => (filter === "ALL" || (filter === "LINKED" ? client.links.length > 0 : !client.links.length)) && [client.name, ...client.links.map(link => link.name + " " + link.externalId)].some(value => value.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")))) || [];
  return <>
    <Paper component="button" type="button" withBorder radius="md" p="md" ta="left" style={{ cursor: "pointer", color: "inherit", background: "var(--fortuno-surface)" }} onClick={() => setOpened(true)} aria-label="Ver clientes vinculados e não vinculados">
      <Text size="sm" c="dimmed">Clientes com vínculo</Text><Text size="xl" fw={850}>{data ? data.percentage.toLocaleString("pt-BR") + "%" : error ? "Indisponível" : "…"}</Text>
      <Progress value={data?.percentage || 0} size="xs" my={6}/><Text size="xs" c="dimmed">{data ? `${data.linked} de ${data.total} clientes ativos · ver vínculos` : "Consultar grupos e contatos"}</Text>
    </Paper>
    <Modal opened={opened} onClose={() => setOpened(false)} title="Vínculos de clientes no WhatsApp" size="xl" centered>
      <Stack gap="md">
        {error && <Alert color="orange">{error}</Alert>}
        {success && <Alert color="teal" withCloseButton onClose={() => setSuccess("")}>{success}</Alert>}
        {!data && !error && <Loader size="sm"/>}
        {data && <><Text size="sm" c="dimmed">{data.linked} de {data.total} clientes ativos com grupo ou contato vinculado ao número conectado. Cada cliente conta uma vez no percentual.</Text>
          <SegmentedControl value={filter} onChange={setFilter} data={[{ value: "ALL", label: `Todos (${data.total})` }, { value: "LINKED", label: `Vinculados (${data.linked})` }, { value: "UNLINKED", label: `Sem vínculo (${data.unlinked})` }]}/>
          <TextInput aria-label="Buscar cliente ou vínculo" placeholder="Buscar cliente, grupo ou contato" value={search} onChange={event => setSearch(event.currentTarget.value)}/>
          <div style={{ maxHeight: "60dvh", overflowY: "auto" }}><Stack gap="sm">{rows.map(client => <Paper key={client.id} withBorder radius="md" p="sm"><Group justify="space-between" wrap="nowrap"><Text fw={700} size="sm">{client.name}</Text><Badge color={client.links.length ? "teal" : "gray"} variant="light">{client.links.length ? `${client.links.length} vínculo(s)` : "Sem vínculo"}</Badge></Group>
            {client.links.map(link => <Group key={link.kind + link.externalId} justify="space-between" mt="xs" wrap="nowrap"><div><Text size="sm">{link.name}</Text><Text size="xs" c="dimmed">{link.kind === "GROUP" ? "Grupo" : "Contato"} · {link.externalId}</Text></div><Group gap="xs" wrap="nowrap">{link.ticketId && <Button variant="subtle" size="compact-xs" onClick={() => { setOpened(false); onOpenTicket(link.ticketId!); }}>Abrir conversa</Button>}{canEdit && <Button variant="subtle" color="red" size="compact-xs" aria-label={"Remover vínculo de " + link.name} loading={removing === client.id + link.kind + link.externalId} disabled={Boolean(removing)} onClick={() => void remove(client.id, link)}>Remover vínculo</Button>}</Group></Group>)}
            {canEdit && <Button variant="light" size="compact-xs" mt="sm" aria-label={`Vincular contato ou grupo a ${client.name}`} onClick={() => setLinkTarget({ id: client.id, name: client.name })}>{client.links.length ? "Adicionar vínculo" : "Vincular contato ou grupo"}</Button>}
          </Paper>)}{!rows.length && <Text c="dimmed" ta="center" py="lg">Nenhum cliente encontrado.</Text>}</Stack></div></>}
      </Stack>
    </Modal>
    {linkTarget && <WhatsAppLinkClientPicker key={linkTarget.id} client={linkTarget} onClose={() => setLinkTarget(null)} onLinked={count => { setSuccess(`${count} vínculo(s) salvo(s) para ${linkTarget.name}.`); setLinkTarget(null); setRefresh(value => value + 1); }}/>}
  </>;
}
