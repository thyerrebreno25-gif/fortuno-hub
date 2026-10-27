"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconRefresh } from "@tabler/icons-react";

type Interaction = { id: string; action: string; note?: string | null; user?: { name?: string | null; email?: string | null } | null };
type Finding = {
  id: string; title: string; description: string; severity: string; status: string;
  category?: string | null; source?: string | null; flow?: string | null; operatorId?: string | null;
  supervisorNote?: string | null; dueAt?: string | null; interactions?: Interaction[];
};
type Audit = {
  id: string; referenceLabel?: string | null; periodStart?: string | null; periodEnd?: string | null;
  client: { id: string; name: string }; supervisor?: { name?: string | null; email?: string | null } | null;
  findings: Finding[];
};
type Bootstrap = { currentUser: { id: string; role: string; name?: string | null; email: string } };
const CLOSED = new Set(["VALIDATED", "DISMISSED"]);

function label(value: string) {
  return ({ SENT: "Enviado", IN_PROGRESS: "Em andamento", PENDING_VALIDATION: "Aguardando check do líder", VALIDATED: "Validado", RETURNED: "Devolvido", DISMISSED: "Descartado" } as Record<string, string>)[value] || value;
}
function color(value: string) {
  if (value === "VALIDATED") return "green";
  if (value === "PENDING_VALIDATION") return "yellow";
  if (value === "RETURNED") return "red";
  if (["SENT", "IN_PROGRESS"].includes(value)) return "blue";
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

export default function MinhasAuditoriasPage() {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ finding: Finding; note: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        fetch("/api/audit/bootstrap", { cache: "no-store" }),
        fetch("/api/audit", { cache: "no-store" }),
      ]);
      const bp: Bootstrap & { error?: string } = await b.json();
      const ap = await a.json();
      if (!b.ok) throw new Error(bp.error || "Não foi possível carregar o usuário.");
      if (!a.ok) throw new Error(ap.error || "Não foi possível carregar as auditorias.");
      const userId = bp.currentUser.id;
      const mine = (ap.audits || [])
        .map((audit: Audit) => ({ ...audit, findings: audit.findings.filter((f) => f.operatorId === userId) }))
        .filter((audit: Audit) => audit.findings.length > 0);
      setAudits(mine);
    } catch (error) {
      notifications.show({ color: "red", title: "Minhas Auditorias", message: error instanceof Error ? error.message : "Erro inesperado." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function action(id: string, actionName: "START" | "COMPLETE", note?: string) {
    const response = await fetch(`/api/audit/findings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: actionName, note: note?.trim() || undefined }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a correção.");
    notifications.show({ color: actionName === "START" ? "blue" : "green", title: actionName === "START" ? "Correção iniciada" : "Enviado para o líder", message: actionName === "START" ? "O item está em andamento." : "Sua devolutiva foi enviada para o check do líder." });
    await load();
  }

  const summary = useMemo(() => {
    const findings = audits.flatMap((a) => a.findings);
    return {
      pending: findings.filter((f) => !CLOSED.has(f.status)).length,
      newItems: findings.filter((f) => f.status === "SENT").length,
      progress: findings.filter((f) => ["IN_PROGRESS", "RETURNED"].includes(f.status)).length,
      validation: findings.filter((f) => f.status === "PENDING_VALIDATION").length,
      overdue: findings.filter(overdue).length,
    };
  }, [audits]);

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>Auditoria • Operador</Text>
          <Title order={2}>Minhas Auditorias</Title>
        </div>
        <Button variant="default" leftSection={<IconRefresh size={16} />} loading={loading} onClick={() => void load()}>Atualizar</Button>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Metric label="Pendentes" value={summary.pending} />
        <Metric label="Novos" value={summary.newItems} />
        <Metric label="Em andamento" value={summary.progress} />
        <Metric label="Em validação" value={summary.validation} />
        <Metric label="Atrasados" value={summary.overdue} />
      </SimpleGrid>

      {!loading && audits.length === 0 ? <Alert color="green">Você não possui apontamentos de auditoria atribuídos.</Alert> : (
        <Accordion variant="separated" multiple>
          {audits.map((audit) => {
            const open = audit.findings.filter((f) => !CLOSED.has(f.status));
            const resolved = audit.findings.length - open.length;
            const progress = audit.findings.length ? Math.round((resolved / audit.findings.length) * 100) : 100;
            return <Accordion.Item key={audit.id} value={audit.id}>
              <Accordion.Control>
                <Stack gap={8} pr="md">
                  <Group justify="space-between"><div><Text fw={800}>{audit.client.name}</Text><Text size="xs" c="dimmed">{audit.referenceLabel || `${formatDate(audit.periodStart)} → ${formatDate(audit.periodEnd)}`} • Líder: {audit.supervisor?.name || audit.supervisor?.email || "—"}</Text></div><Badge>{open.length} pendente{open.length === 1 ? "" : "s"}</Badge></Group>
                  <Progress value={progress} radius="xl" />
                </Stack>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {audit.findings.map((finding) => <Paper key={finding.id} withBorder radius="md" p="md">
                    <Group gap="xs">{finding.flow === "PAYABLE" && <Badge color="orange" variant="dot">Contas a Pagar</Badge>}{finding.flow === "RECEIVABLE" && <Badge color="green" variant="dot">Contas a Receber</Badge>}<Badge color={finding.severity === "CRITICAL" ? "red" : finding.severity === "WARNING" ? "orange" : "blue"}>{finding.severity}</Badge><Badge color={color(finding.status)} variant="outline">{label(finding.status)}</Badge>{finding.source === "SUPERVISOR_CHECKLIST" && <Badge color="violet">Checklist</Badge>}{overdue(finding) && <Badge color="red">Atrasado</Badge>}</Group>
                    <Text fw={700} mt="xs">{finding.title}</Text><Text size="sm" c="dimmed">{finding.description}</Text>
                    {finding.supervisorNote && <Alert color="blue" mt="sm" title="Orientação do líder">{finding.supervisorNote}</Alert>}
                    <SimpleGrid cols={{ base: 1, sm: 2 }} mt="sm"><Text size="xs"><b>Prazo:</b> {formatDate(finding.dueAt)}</Text><Text size="xs"><b>Categoria:</b> {finding.category || "—"}</Text></SimpleGrid>
                    {(finding.interactions?.length ?? 0) > 0 && <Accordion mt="sm" variant="contained"><Accordion.Item value={`hist-${finding.id}`}><Accordion.Control>Histórico da correção</Accordion.Control><Accordion.Panel><Stack gap={4}>{(finding.interactions ?? []).map((i) => <Text key={i.id} size="xs" c="dimmed"><b>{i.user?.name || i.user?.email || "Usuário"}</b>: {i.action}{i.note ? ` — ${i.note}` : ""}</Text>)}</Stack></Accordion.Panel></Accordion.Item></Accordion>}
                    <Group mt="md">
                      {["SENT", "RETURNED"].includes(finding.status) && <Button size="xs" onClick={async () => { try { await action(finding.id, "START"); } catch (error) { notifications.show({ color: "red", title: "Auditoria", message: error instanceof Error ? error.message : "Erro inesperado." }); } }}>{finding.status === "RETURNED" ? "Retomar correção" : "Iniciar correção"}</Button>}
                      {finding.status === "IN_PROGRESS" && <Button size="xs" color="green" onClick={() => setModal({ finding, note: "" })}>Concluir e enviar para o líder</Button>}
                      {finding.status === "PENDING_VALIDATION" && <Alert color="yellow" py={6}>Aguardando check do líder.</Alert>}
                      {finding.status === "VALIDATED" && <Badge color="green">Correção validada</Badge>}
                    </Group>
                  </Paper>)}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>;
          })}
        </Accordion>
      )}

      <Modal opened={!!modal} onClose={() => setModal(null)} title="Devolutiva da correção" centered>
        {modal && <Stack><Text fw={700}>{modal.finding.title}</Text><Textarea label="O que foi feito?" description="Explique a correção realizada para o líder conferir." required minRows={5} value={modal.note} onChange={(e) => setModal({ ...modal, note: e.currentTarget.value })} /><Button color="green" disabled={!modal.note.trim()} onClick={async () => { try { await action(modal.finding.id, "COMPLETE", modal.note); setModal(null); } catch (error) { notifications.show({ color: "red", title: "Auditoria", message: error instanceof Error ? error.message : "Erro inesperado." }); } }}>Enviar para o líder</Button></Stack>}
      </Modal>
    </Stack>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Paper withBorder radius="lg" p="md"><Text size="xs" c="dimmed" fw={700} tt="uppercase">{label}</Text><Text fz={28} fw={800}>{value}</Text></Paper>;
}
