"use client";

import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconClock,
  IconInbox,
  IconMail,
  IconSearch,
  IconSparkles,
  IconTrash,
  IconUser,
  IconUsers,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { GmailConnectionCard } from "@/modules/atendimento/components/gmail-connection-card";
import { EmailTicketDrawer } from "@/modules/atendimento/components/email-ticket-drawer";
import styles from "./atendimento.module.css";

type Any = Record<string, any>;

const views = [
  ["GENERAL", "Caixa Geral", "general", IconInbox],
  ["MINE", "Minha Caixa", "mine", IconUser],
  ["UNASSIGNED", "Não atribuídos", "unassigned", IconUsers],
  ["WAITING", "Aguardando", "waiting", IconClock],
  ["RESOLVED", "Resolvidos", "resolved", IconCircleCheck],
  ["SPAM", "Spam", "spam", IconTrash],
  ["ARCHIVED", "Arquivados", "archived", IconInbox],
] as const;

const statusLabels: Any = {
  NEW: "Novo",
  IN_PROGRESS: "Em atendimento",
  WAITING_CUSTOMER: "Aguardando cliente",
  WAITING_INTERNAL: "Aguardando interno",
  RESOLVED: "Resolvido",
  SPAM: "Spam",
};

const statusColors: Any = {
  NEW: "blue",
  IN_PROGRESS: "cyan",
  WAITING_CUSTOMER: "yellow",
  WAITING_INTERNAL: "orange",
  RESOLVED: "green",
  SPAM: "gray",
};

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export default function AtendimentoPage() {
  const [bootstrap, setBootstrap] = useState<Any | null>(null);
  const [tickets, setTickets] = useState<Any[]>([]);
  const [stats, setStats] = useState<Any>({});
  const [view, setView] = useState("GENERAL");
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Any | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiveAction, setArchiveAction] = useState<"archive" | "restore" | "delete" | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [note, setNote] = useState("");

  const [form, setForm] = useState({
    subject: "",
    senderName: "",
    senderEmail: "",
    recipientEmail: "",
    textBody: "",
    clientId: "",
    assignedToId: "",
    priority: "MEDIUM",
  });


  const loadBootstrap = useCallback(async () => {
    const response = await fetch("/api/atendimento/bootstrap", {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Erro ao carregar Central.");
    setBootstrap(body);
  }, []);

  const loadTickets = useCallback(async () => {
    const query = new URLSearchParams({ view });
    if (search.trim()) query.set("search", search.trim());
    if (selectedMemberId) query.set("assignedToId", selectedMemberId);

    const response = await fetch(
      `/api/atendimento?${query.toString()}`,
      { cache: "no-store" },
    );
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Erro ao carregar chamados.");
    setTickets(body.tickets || []);
    setStats(body.stats || {});
  }, [view, search, selectedMemberId]);

  async function archiveMailbox(action: "archive" | "restore" | "delete") {
    setArchiveAction(null);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/atendimento/archive", { method: action === "delete" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation: deleteConfirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao atualizar a caixa.");
      setSelected(null); setSelectedId(null);
      setDeleteConfirmation("");
      await loadTickets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar a caixa."); }
    finally { setSaving(false); }
  }

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError("");
      try {
        await Promise.all([loadBootstrap(), loadTickets()]);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Erro ao carregar Central.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [loadBootstrap, loadTickets]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") { void fetch("/api/atendimento/gmail/sync", { method: "POST" }).then(() => loadTickets()).catch(() => {}); } };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [loadTickets]);

  const openTicket = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);

    try {
      const response = await fetch(`/api/atendimento/${id}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao abrir chamado.");
      setSelected(body.ticket);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível abrir o chamado.",
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function updateTicket(action: string, payload: Any = {}) {
    if (!selectedId) return false;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/atendimento/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao atualizar chamado.");

      setSelected(body.ticket);
      await loadTickets();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível atualizar.",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function createTestTicket() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/atendimento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Erro ao criar chamado.");

      setNewOpen(false);
      setForm({
        subject: "",
        senderName: "",
        senderEmail: "",
        recipientEmail: "",
        textBody: "",
        clientId: "",
        assignedToId: "",
        priority: "MEDIUM",
      });
      await loadTickets();
      await openTicket(body.ticket.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao criar chamado.");
    } finally {
      setSaving(false);
    }
  }

  const memberOptions = useMemo(
    () =>
      (bootstrap?.members || []).map((member: Any) => ({
        value: member.id,
        label: member.name || member.email,
      })),
    [bootstrap],
  );

  const clientOptions = useMemo(
    () =>
      (bootstrap?.clients || []).map((client: Any) => ({
        value: client.id,
        label: client.name,
      })),
    [bootstrap],
  );

  const selectedTeamMember = useMemo(
    () =>
      (bootstrap?.members || []).find(
        (member: Any) => member.id === selectedMemberId,
      ) || null,
    [bootstrap, selectedMemberId],
  );

  if (loading) {
    return (
      <Group justify="center" py={80}>
        <Loader />
      </Group>
    );
  }

  if (!bootstrap) {
    return <Alert color="red">{error || "Central indisponível."}</Alert>;
  }


  return (
    <Stack gap="sm" className={styles.page}>
      <Modal opened={archiveAction !== null} onClose={() => setArchiveAction(null)} title={archiveAction === "delete" ? "Excluir todos os arquivados" : archiveAction === "restore" ? "Restaurar arquivados" : "Limpar caixa de e-mails"}>
        <Stack>
          <Text size="sm">{archiveAction === "delete" ? `Excluir definitivamente os ${stats.archived ?? 0} atendimentos arquivados, incluindo mensagens, anexos e histórico no Fortuno Hub. Esta ação não pode ser desfeita. Os originais no Gmail não serão alterados.` : archiveAction === "restore" ? "Os atendimentos arquivados voltarão às caixas originais." : "Os atendimentos atuais serão movidos para Arquivados e poderão ser restaurados. Os e-mails originais no Gmail não serão alterados."}</Text>
          {archiveAction === "delete" && <TextInput label="Digite EXCLUIR ARQUIVADOS para confirmar" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.currentTarget.value)} />}
          <Group justify="flex-end"><Button variant="default" onClick={() => setArchiveAction(null)}>Cancelar</Button><Button color={archiveAction === "delete" ? "red" : undefined} disabled={archiveAction === "delete" && deleteConfirmation !== "EXCLUIR ARQUIVADOS"} onClick={() => archiveAction && void archiveMailbox(archiveAction)}>{archiveAction === "delete" ? "Excluir definitivamente" : archiveAction === "restore" ? "Restaurar atendimentos" : "Arquivar atendimentos"}</Button></Group>
        </Stack>
      </Modal>
      <Group
        justify="space-between"
        align="flex-start"
        className={styles.pageHeader}
      >
        <Stack gap={3}>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>
            Fortuno Hub
          </Text>
          <Title order={2} className={styles.pageTitle}>
            Central de e-mails
          </Title>
        </Stack>

        <Group className={styles.headerActions}>
          {bootstrap.permission?.canManage && view === "ARCHIVED" && <Button color="red" variant="light" loading={saving} onClick={() => { setDeleteConfirmation(""); setArchiveAction("delete"); }}>Excluir todos os arquivados</Button>}
          {bootstrap.permission?.canManage && <Button variant="default" loading={saving} onClick={() => setArchiveAction(view === "ARCHIVED" ? "restore" : "archive")}>{view === "ARCHIVED" ? "Restaurar arquivados" : "Limpar caixa"}</Button>}
          <Badge size="lg" variant="light" leftSection={<IconSparkles size={13} />}>
            Atendimento por e-mail
          </Badge>

          {bootstrap.permission?.canCreate && (
            <Button
              leftSection={<IconMail size={17} />}
              onClick={() => setNewOpen(true)}
            >
              Simular e-mail
            </Button>
          )}
        </Group>
      </Group>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      <div className={styles.gmailCard}>
        <GmailConnectionCard />
      </div>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <Stack gap={6}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase" px={8} py={6}>
              Caixas
            </Text>

            {views.map(([value, label, stat, Icon]) => (
              <Button
                key={value}
                className={styles.viewButton}
                variant={view === value ? "light" : "subtle"}
                color={value === "SPAM" ? "gray" : "blue"}
                justify="space-between"
                fullWidth
                leftSection={<Icon size={16} />}
                rightSection={
                  <Badge size="sm" variant={view === value ? "filled" : "light"}>
                    {stats[stat] ?? 0}
                  </Badge>
                }
                 onClick={() => {
                   setView(value);
                   setSelectedMemberId(null);
                   setSelected(null);
                   setSelectedId(null);
                }}
              >
                {label}
              </Button>
             ))}

             {bootstrap.currentUser?.canManage && (
               <>
                 <Text
                   size="xs"
                   fw={800}
                   c="dimmed"
                   tt="uppercase"
                   px={8}
                   pt="md"
                   pb={6}
                   className={styles.teamTitle}
                 >
                   Equipe
                 </Text>
                 <ScrollArea.Autosize mah={280} type="auto">
                   <Stack gap={4}>
                     {(bootstrap.members || []).map((member: Any) => (
                       <Button
                         key={member.id}
                         className={`${styles.viewButton} ${styles.teamButton}`}
                         variant={selectedMemberId === member.id ? "light" : "subtle"}
                         justify="space-between"
                         fullWidth
                         leftSection={<IconUser size={15} />}
                         rightSection={
                           <Badge
                             size="sm"
                             variant={selectedMemberId === member.id ? "filled" : "light"}
                           >
                             {stats.byMember?.[member.id] ?? 0}
                           </Badge>
                         }
                         title={member.name || member.email}
                         onClick={() => {
                           setView("TEAM");
                           setSelectedMemberId(member.id);
                           setSelected(null);
                           setSelectedId(null);
                         }}
                       >
                         {member.name || member.email}
                       </Button>
                     ))}
                   </Stack>
                 </ScrollArea.Autosize>
               </>
             )}
           </Stack>
        </aside>

        <section className={styles.list}>
          <div className={styles.searchBar}>
            <Group gap="sm" wrap="nowrap">
              {selectedTeamMember && (
                <Badge size="lg" variant="light" className={styles.memberFilterBadge}>
                  {selectedTeamMember.name || selectedTeamMember.email}
                </Badge>
              )}
              <TextInput
                placeholder={
                  selectedTeamMember
                    ? `Buscar nos e-mails de ${selectedTeamMember.name || selectedTeamMember.email}...`
                    : "Buscar cliente, assunto ou remetente..."
                }
                leftSection={<IconSearch size={16} />}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                style={{ flex: 1 }}
              />
            </Group>
          </div>

          <ScrollArea style={{ flex: 1, minHeight: 0 }} type="auto">
            {!tickets.length ? (
              <Stack align="center" gap="xs" py={80} px="md">
                <ThemeIcon size={50} radius="xl" variant="light">
                  <IconInbox size={24} />
                </ThemeIcon>
                <Text fw={700}>Caixa vazia</Text>
                <Text size="sm" c="dimmed" ta="center">
                  Nenhum chamado encontrado nesta visão.
                </Text>
              </Stack>
            ) : (
              tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className={`${styles.ticketRow} ${
                    selectedId === ticket.id ? styles.ticketRowActive : ""
                  }`}
                  onClick={() => void openTicket(ticket.id)}
                >
                  <div className={styles.ticketMain}>
                    <Group gap={8} wrap="nowrap">
                      <Text size="sm" fw={800} lineClamp={1}>
                        {ticket.client?.name ||
                          ticket.senderName ||
                          ticket.senderEmail}
                      </Text>

                      <Badge
                        size="xs"
                        color={statusColors[ticket.status] || "gray"}
                        variant="light"
                        className={styles.rowStatus}
                      >
                        {statusLabels[ticket.status] || ticket.status}
                      </Badge>

                      {!ticket.assignedTo ? (
                        <Badge
                          size="xs"
                          color="orange"
                          variant="light"
                          className={styles.rowAssignee}
                        >
                          Sem responsável
                        </Badge>
                      ) : (
                        <Badge
                          size="xs"
                          variant="outline"
                          className={styles.rowAssignee}
                        >
                          {ticket.assignedTo.name || ticket.assignedTo.email}
                        </Badge>
                      )}
                    </Group>

                    <Group gap={7} wrap="nowrap" mt={2}>
                      <Text
                        size="sm"
                        fw={600}
                        lineClamp={1}
                        className={styles.ticketSubject}
                      >
                        {ticket.subject}
                      </Text>
                      <Text
                        size="xs"
                        c="dimmed"
                        lineClamp={1}
                        className={styles.ticketSnippet}
                      >
                        — {ticket.snippet || ticket.senderEmail}
                      </Text>
                    </Group>
                  </div>

                  <Text
                    size="xs"
                    c="dimmed"
                    className={styles.ticketDate}
                  >
                    {formatDate(ticket.lastMessageAt)}
                  </Text>
                </div>
              ))
            )}
          </ScrollArea>
        </section>

      </div>

      <EmailTicketDrawer
        opened={Boolean(selectedId)}
        loading={detailLoading}
        ticket={selected}
        bootstrap={bootstrap}
        saving={saving}
        note={note}
        setNote={setNote}
        updateTicket={updateTicket}
        memberOptions={memberOptions}
        clientOptions={clientOptions}
        onClose={() => {
          setSelected(null);
          setSelectedId(null);
        }}
      />

      <Modal
        opened={newOpen}
        onClose={() => setNewOpen(false)}
        title="Simular novo e-mail"
        size="lg"
      >
        <Stack>
          <Alert color="blue">
            Serve apenas para testar a Central antes da conexão real com o Gmail.
          </Alert>

          <Group grow align="flex-start">
            <TextInput
              label="Nome do remetente"
              value={form.senderName}
              onChange={(event) =>
                setForm({ ...form, senderName: event.currentTarget.value })
              }
            />
            <TextInput
              label="E-mail do remetente"
              required
              value={form.senderEmail}
              onChange={(event) =>
                setForm({ ...form, senderEmail: event.currentTarget.value })
              }
            />
          </Group>

          <TextInput
            label="Assunto"
            required
            value={form.subject}
            onChange={(event) =>
              setForm({ ...form, subject: event.currentTarget.value })
            }
          />

          <Textarea
            label="Mensagem"
            required
            minRows={5}
            value={form.textBody}
            onChange={(event) =>
              setForm({ ...form, textBody: event.currentTarget.value })
            }
          />

          <Group grow align="flex-start">
            <Select
              label="Cliente opcional"
              searchable
              clearable
              data={clientOptions}
              value={form.clientId || null}
              onChange={(value) =>
                setForm({ ...form, clientId: value || "" })
              }
            />
            <Select
              label="Responsável opcional"
              searchable
              clearable
              data={memberOptions}
              value={form.assignedToId || null}
              onChange={(value) =>
                setForm({ ...form, assignedToId: value || "" })
              }
            />
          </Group>

          <Group justify="flex-end">
            <Button variant="default" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={() => void createTestTicket()}>
              Criar chamado
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
