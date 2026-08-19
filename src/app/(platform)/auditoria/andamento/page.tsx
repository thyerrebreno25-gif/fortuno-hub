"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh, IconSearch, IconTrash } from "@tabler/icons-react";

type Interaction = { id: string; action: string; note?: string | null; user?: { name?: string | null; email?: string | null } | null };
type Finding = {
  id: string; title: string; description: string; severity: string; status: string;
  category?: string | null; source?: string | null; operatorId?: string | null;
  operator?: { name?: string | null; email: string } | null; supervisorNote?: string | null;
  dueAt?: string | null; interactions?: Interaction[];
};
type Audit = {
  id: string; status: string; healthScore?: number | null; referenceLabel?: string | null;
  periodStart?: string | null; periodEnd?: string | null; createdAt: string;
  client: { id: string; name: string };
  supervisor?: { name?: string | null; email?: string | null } | null;
  findings: Finding[];
};
type Bootstrap = {
  currentUser: { id: string; role: string; name?: string | null; email: string; canSupervise: boolean };
  clients: Array<{ id: string; name: string }>;
  operators: Array<{ id: string; name: string; email: string; role: string }>;
};

const CLOSED = new Set(["VALIDATED", "DISMISSED"]);

function label(value: string) {
  return ({
    DRAFT: "Rascunho", IN_REVIEW: "Em revisão", SENT_TO_CORRECTION: "Em correção",
    PENDING_VALIDATION: "Aguardando check do líder", COMPLETED: "Concluída", IDENTIFIED: "Identificado",
    DISMISSED: "Descartado", SENT: "Enviado", IN_PROGRESS: "Em andamento",
    VALIDATED: "Validado", RETURNED: "Devolvido",
  } as Record<string, string>)[value] || value;
}

function color(value: string) {
  if (["COMPLETED", "VALIDATED"].includes(value)) return "green";
  if (value === "PENDING_VALIDATION") return "yellow";
  if (value === "RETURNED") return "red";
  if (["SENT", "IN_PROGRESS", "SENT_TO_CORRECTION"].includes(value)) return "blue";
  return "gray";
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function overdue(finding: Finding) {
  if (!finding.dueAt || CLOSED.has(finding.status)) return false;
  const due = new Date(finding.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

function lastNote(finding: Finding) {
  const items = finding.interactions ?? [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].note) return items[i].note;
  }
  return null;
}

export default function AuditoriasEmAndamentoPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>("OPEN");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ finding: Finding; action: "VALIDATE" | "RETURN"; note: string } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{
    audit: Audit;
    confirmation: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        fetch("/api/audit/bootstrap", { cache: "no-store" }),
        fetch("/api/audit", { cache: "no-store" }),
      ]);
      const bp = await b.json();
      const ap = await a.json();
      if (!b.ok) throw new Error(bp.error || "Não foi possível carregar o módulo.");
      if (!a.ok) throw new Error(ap.error || "Não foi possível carregar as auditorias.");
      setBootstrap(bp);
      setAudits(ap.audits || []);
    } catch (error) {
      notifications.show({ color: "red", title: "Auditorias", message: error instanceof Error ? error.message : "Erro inesperado." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function deleteAudit(audit: Audit) {
    const response = await fetch(`/api/audit/${audit.id}`, {
      method: "DELETE",
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload.error || "Não foi possível excluir a auditoria.",
      );
    }

    setAudits((current) =>
      current.filter((item) => item.id !== audit.id),
    );

    notifications.show({
      color: "green",
      title: "Auditoria excluída",
      message: `${audit.client.name} foi removida das auditorias.`,
    });
  }

  async function findingAction(id: string, action: "VALIDATE" | "RETURN", note?: string) {
    const response = await fetch(`/api/audit/findings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: note?.trim() || undefined }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar o apontamento.");
    await load();
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return audits.filter((audit) => {
      const unresolved = audit.findings.filter((f) => !CLOSED.has(f.status));
      if (status === "OPEN" && unresolved.length === 0) return false;
      if (status === "OVERDUE" && !unresolved.some(overdue)) return false;
      if (status === "VALIDATION" && !unresolved.some((f) => f.status === "PENDING_VALIDATION")) return false;
      if (status === "COMPLETED" && unresolved.length > 0) return false;
      if (clientId && audit.client.id !== clientId) return false;
      if (operatorId && !audit.findings.some((f) => f.operatorId === operatorId)) return false;
      if (q && !`${audit.client.name} ${audit.referenceLabel || ""} ${audit.supervisor?.name || ""}`.toLowerCase().includes(q)) return false;
      return true;
    }).sort((left, right) => {
      const leftOverdue = left.findings.filter(overdue).length;
      const rightOverdue = right.findings.filter(overdue).length;
      return rightOverdue - leftOverdue;
    });
  }, [audits, clientId, operatorId, search, status]);

  const summary = useMemo(() => {
    const findings = audits.flatMap((a) => a.findings);
    return {
      audits: audits.filter((a) => a.findings.some((f) => !CLOSED.has(f.status))).length,
      operator: findings.filter((f) => ["SENT", "IN_PROGRESS", "RETURNED"].includes(f.status)).length,
      validation: findings.filter((f) => f.status === "PENDING_VALIDATION").length,
      overdue: findings.filter(overdue).length,
      completed: audits.filter((a) => a.findings.length > 0 && a.findings.every((f) => CLOSED.has(f.status))).length,
    };
  }, [audits]);

  const isManager = Boolean(bootstrap?.currentUser.canSupervise);
  if (!loading && bootstrap && !isManager) return <Alert color="orange">Esta visão é exclusiva da liderança.</Alert>;

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>Auditoria • Liderança</Text>
          <Title order={2}>Check das auditorias</Title>
          <Text c="dimmed">Acompanhe os relatórios auditados, priorize itens vencidos e faça o check das correções devolvidas pelos operadores.</Text>
        </div>
        <Group>
          <Button component={Link} href="/auditoria">+ Nova auditoria</Button>
          <Button variant="default" leftSection={<IconRefresh size={16} />} loading={loading} onClick={() => void load()}>Atualizar</Button>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Metric label="Em aberto" value={summary.audits} />
        <Metric label="Com operador" value={summary.operator} />
        <Metric label="Aguardando seu check" value={summary.validation} />
        <Metric label="Vencidos" value={summary.overdue} />
        <Metric label="Concluídas" value={summary.completed} />
      </SimpleGrid>

      <Paper withBorder radius="lg" p="md">
        <SimpleGrid cols={{ base: 1, md: 4 }}>
          <TextInput label="Buscar" placeholder="Cliente ou competência" leftSection={<IconSearch size={15} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Select label="Cliente" placeholder="Todos" clearable searchable data={bootstrap?.clients.map((c) => ({ value: c.id, label: c.name })) || []} value={clientId} onChange={setClientId} />
          <Select label="Operador" placeholder="Todos" clearable searchable data={bootstrap?.operators.map((o) => ({ value: o.id, label: o.name })) || []} value={operatorId} onChange={setOperatorId} />
          <Select label="Situação" data={[{ value: "OPEN", label: "Em aberto" }, { value: "OVERDUE", label: "Somente vencidas" }, { value: "VALIDATION", label: "Aguardando check do líder" }, { value: "ALL", label: "Todas" }, { value: "COMPLETED", label: "Concluídas" }]} value={status} onChange={setStatus} />
        </SimpleGrid>
      </Paper>

      {!loading && filtered.length === 0 ? <Alert color="blue">Nenhuma auditoria encontrada.</Alert> : (
        <Accordion variant="separated" multiple>
          {filtered.map((audit) => {
            const unresolved = audit.findings.filter((f) => !CLOSED.has(f.status));
            const resolved = audit.findings.length - unresolved.length;
            const progress = audit.findings.length ? Math.round((resolved / audit.findings.length) * 100) : 100;
            const overdueItems = unresolved.filter(overdue);
            const withOperator = unresolved.filter((f) => ["SENT", "IN_PROGRESS", "RETURNED"].includes(f.status) && !overdue(f));
            const validation = unresolved.filter((f) => f.status === "PENDING_VALIDATION" && !overdue(f));
            const identified = unresolved.filter((f) => f.status === "IDENTIFIED" && !overdue(f));
            return (
              <Accordion.Item key={audit.id} value={audit.id}>
                <Accordion.Control>
                  <Stack gap={8} pr="md">
                    <Group justify="space-between">
                      <div>
                        <Group gap="xs"><Text fw={800}>{audit.client.name}</Text><Badge color={color(audit.status)}>{label(audit.status)}</Badge></Group>
                        <Text size="xs" c="dimmed">{audit.referenceLabel || `${formatDate(audit.periodStart)} → ${formatDate(audit.periodEnd)}`} • Líder: {audit.supervisor?.name || audit.supervisor?.email || "—"}</Text>
                      </div>
                      <Badge variant="outline">{resolved}/{audit.findings.length} resolvidos</Badge>
                    </Group>
                    <Progress value={progress} radius="xl" />
                    <Group gap="xs">{overdueItems.length > 0 && <Badge color="red">{overdueItems.length} vencido(s)</Badge>}<Badge color="blue">{withOperator.length} com operador</Badge><Badge color="yellow">{validation.length} aguardando check</Badge><Badge color="gray">{unresolved.length} em aberto</Badge></Group>
                  </Stack>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="lg">
                    <Group justify="space-between" align="center">
                      <Text size="xs" c="dimmed">
                        Auditoria criada em {formatDate(audit.createdAt)}
                      </Text>

                      <Button
                        size="xs"
                        color="red"
                        variant="light"
                        leftSection={<IconTrash size={14} />}
                        onClick={() =>
                          setDeleteModal({
                            audit,
                            confirmation: "",
                          })
                        }
                      >
                        Excluir auditoria
                      </Button>
                    </Group>
                    {overdueItems.length > 0 && <Section title="Vencidos — ação prioritária">{overdueItems.map((f) => <FindingCard key={f.id} finding={f} onValidate={f.status === "PENDING_VALIDATION" ? () => setModal({ finding: f, action: "VALIDATE", note: "" }) : undefined} onReturn={f.status === "PENDING_VALIDATION" ? () => setModal({ finding: f, action: "RETURN", note: "" }) : undefined} />)}</Section>}
                    {validation.length > 0 && <Section title="Aguardando check do líder">{validation.map((f) => <FindingCard key={f.id} finding={f} onValidate={() => setModal({ finding: f, action: "VALIDATE", note: "" })} onReturn={() => setModal({ finding: f, action: "RETURN", note: "" })} />)}</Section>}
                    {withOperator.length > 0 && <Section title="Pendente com operador">{withOperator.map((f) => <FindingCard key={f.id} finding={f} />)}</Section>}
                    {identified.length > 0 && <Section title="Ainda não direcionados">{identified.map((f) => <FindingCard key={f.id} finding={f} />)}</Section>}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}

      <Modal
        opened={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Excluir auditoria"
        centered
      >
        {deleteModal && (
          <Stack>
            <Alert color="red" title="Esta ação é permanente">
              Ao excluir esta auditoria, os reports, checklist, histórico de
              interações e pendências enviadas aos operadores também serão
              removidos.
            </Alert>

            <Paper withBorder radius="md" p="md">
              <Text fw={700}>{deleteModal.audit.client.name}</Text>
              <Text size="sm" c="dimmed">
                {deleteModal.audit.referenceLabel ||
                  `${formatDate(deleteModal.audit.periodStart)} → ${formatDate(
                    deleteModal.audit.periodEnd,
                  )}`}
              </Text>
            </Paper>

            <TextInput
              label='Digite "EXCLUIR" para confirmar'
              value={deleteModal.confirmation}
              onChange={(event) =>
                setDeleteModal({
                  ...deleteModal,
                  confirmation: event.currentTarget.value,
                })
              }
            />

            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setDeleteModal(null)}
              >
                Cancelar
              </Button>

              <Button
                color="red"
                leftSection={<IconTrash size={15} />}
                disabled={deleteModal.confirmation.trim().toUpperCase() !== "EXCLUIR"}
                onClick={async () => {
                  try {
                    await deleteAudit(deleteModal.audit);
                    setDeleteModal(null);
                  } catch (error) {
                    notifications.show({
                      color: "red",
                      title: "Excluir auditoria",
                      message:
                        error instanceof Error
                          ? error.message
                          : "Não foi possível excluir a auditoria.",
                    });
                  }
                }}
              >
                Excluir definitivamente
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!modal} onClose={() => setModal(null)} title={modal?.action === "VALIDATE" ? "Check final do líder" : "Devolver ao operador"} centered>
        {modal && <Stack>
          <Text fw={700}>{modal.finding.title}</Text>
          {lastNote(modal.finding) && <Alert color="blue" title="Última devolutiva">{lastNote(modal.finding)}</Alert>}
          <Textarea label={modal.action === "RETURN" ? "Motivo da devolução" : "Observação"} required={modal.action === "RETURN"} minRows={4} value={modal.note} onChange={(e) => setModal({ ...modal, note: e.currentTarget.value })} />
          <Button color={modal.action === "VALIDATE" ? "green" : "orange"} disabled={modal.action === "RETURN" && !modal.note.trim()} onClick={async () => { try { await findingAction(modal.finding.id, modal.action, modal.note); setModal(null); } catch (error) { notifications.show({ color: "red", title: "Auditoria", message: error instanceof Error ? error.message : "Erro inesperado." }); } }}>{modal.action === "VALIDATE" ? "Confirmar validação" : "Devolver para correção"}</Button>
        </Stack>}
      </Modal>
    </Stack>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Paper withBorder radius="lg" p="md"><Text size="xs" c="dimmed" fw={700} tt="uppercase">{label}</Text><Text fz={28} fw={800}>{value}</Text></Paper>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Stack gap="sm"><Text fw={800}>{title}</Text>{children}</Stack>;
}

function FindingCard({ finding, onValidate, onReturn }: { finding: Finding; onValidate?: () => void; onReturn?: () => void }) {
  return <Paper withBorder radius="md" p="md">
    <Group gap="xs"><Badge color={finding.severity === "CRITICAL" ? "red" : finding.severity === "WARNING" ? "orange" : "blue"}>{finding.severity}</Badge><Badge color={color(finding.status)} variant="outline">{label(finding.status)}</Badge>{finding.source === "SUPERVISOR_CHECKLIST" && <Badge color="violet">Checklist</Badge>}{overdue(finding) && <Badge color="red">Atrasado</Badge>}</Group>
    <Text fw={700} mt="xs">{finding.title}</Text><Text size="sm" c="dimmed">{finding.description}</Text>
    <SimpleGrid cols={{ base: 1, sm: 3 }} mt="sm"><Text size="xs"><b>Operador:</b> {finding.operator?.name || finding.operator?.email || "—"}</Text><Text size="xs"><b>Prazo:</b> {formatDate(finding.dueAt)}</Text><Text size="xs"><b>Categoria:</b> {finding.category || "—"}</Text></SimpleGrid>
    {finding.supervisorNote && <Alert color="blue" mt="sm" title="Orientação">{finding.supervisorNote}</Alert>}
    {lastNote(finding) && <Alert color="green" mt="sm" title="Última devolutiva">{lastNote(finding)}</Alert>}
    {finding.status === "PENDING_VALIDATION" && onValidate && onReturn && <Group mt="md"><Button size="xs" color="green" onClick={onValidate}>Validar</Button><Button size="xs" color="orange" variant="light" onClick={onReturn}>Devolver</Button></Group>}
  </Paper>;
}
