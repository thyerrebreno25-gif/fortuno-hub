"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  FileButton,
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
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconClipboardCheck,
  IconFileAnalytics,
  IconRefresh,
  IconSend,
  IconShieldCheck,
  IconUpload,
} from "@tabler/icons-react";

import { analyzeContaAzulDre } from "@/modules/audit/dre-engine";
import { analyzeAuditMovements, combineAuditAnalyses } from "@/modules/audit/engine";
import { parseContaAzulDre } from "@/modules/audit/parsers/conta-azul-dre-parser";
import { parseContaAzulMovements } from "@/modules/audit/parsers/conta-azul-movements-parser";
import type {
  AuditAnalysisResult,
  AuditFindingDraft,
} from "@/modules/audit/types";

type Bootstrap = {
  currentUser: {
    id: string;
    role: string;
    name?: string | null;
    email: string;
    isTeamLeader: boolean;
    canSupervise: boolean;
  };
  clients: Array<{
    id: string;
    name: string;
    document?: string | null;
    operationLeaderId?: string | null;
    payableResponsibleId?: string | null;
    receivableResponsibleId?: string | null;
    contaAzulConnection?: {
      active: boolean;
      status: string;
    } | null;
  }>;
  operators: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
};

type AuditInteraction = {
  id: string;
  action: string;
  note?: string | null;
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
};

type SavedFinding = AuditFindingDraft & {
  id: string;
  flow?: "PAYABLE" | "RECEIVABLE" | "GENERAL";
  status: string;
  operatorId?: string | null;
  supervisorNote?: string | null;
  dueAt?: string | null;
  operator?: {
    name?: string | null;
    email: string;
  } | null;
  interactions?: AuditInteraction[];
};

type SavedAudit = {
  id: string;
  status: string;
  healthScore: number;
  createdAt: string;
  client: {
    id: string;
    name: string;
    payableResponsibleId?: string | null;
    receivableResponsibleId?: string | null;
  };
  findings: SavedFinding[];
  files: Array<{
    id: string;
    type: string;
    name: string;
  }>;
  checklist: Array<{
    id: string;
    category: string;
    title: string;
    description?: string | null;
    mandatory: boolean;
    status: string;
    note?: string | null;
    reviewedById?: string | null;
    reviewedAt?: string | null;
    position: number;
  }>;
  supervisor: unknown;
};

type AssignmentState = {
  finding: SavedFinding;
  operatorId: string | null;
  note: string;
  dueAt: string;
};

type ActionModalState = {
  finding: SavedFinding;
  action: "COMPLETE" | "RETURN" | "DISMISS";
  note: string;
};

type ChecklistReviewState = {
  item: SavedAudit["checklist"][number];
  status: "PENDING" | "COMPLIANT" | "NON_COMPLIANT" | "NOT_APPLICABLE";
  note: string;
  operatorId: string | null;
  dueAt: string;
};

function severityColor(value: string) {
  if (value === "CRITICAL") return "red";
  if (value === "WARNING") return "orange";
  return "blue";
}

function severityLabel(value: string) {
  if (value === "CRITICAL") return "Crítico";
  if (value === "WARNING") return "Atenção";
  return "Observação";
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    IDENTIFIED: "Identificado",
    DISMISSED: "Descartado",
    SENT: "Enviado",
    IN_PROGRESS: "Em andamento",
    PENDING_VALIDATION: "Aguardando check do líder",
    VALIDATED: "Validado",
    RETURNED: "Devolvido",
  };

  return labels[value] || value;
}

function checklistStatusLabel(value: string) {
  const labels: Record<string, string> = {
    PENDING: "Pendente",
    COMPLIANT: "Conforme",
    NON_COMPLIANT: "Não conforme",
    NOT_APPLICABLE: "Não se aplica",
  };

  return labels[value] || value;
}

function checklistStatusColor(value: string) {
  if (value === "COMPLIANT") return "green";
  if (value === "NON_COMPLIANT") return "red";
  if (value === "NOT_APPLICABLE") return "gray";
  return "yellow";
}

function formatDate(value?: string | null) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function currentMonthRange() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  return {
    start: `${prefix}-01`,
    end: `${prefix}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`,
  };
}

type AutomaticAnalysis = {
  healthScore: number;
  historyStart: string;
  historyEnd: string;
  metrics: {
    historyItems: number;
    currentItems: number;
    recurringProfiles: number;
    missingRecurring: number;
    overdue: number;
    open: number;
    competenceDivergences: number;
    categoryDivergences: number;
    duplicates: number;
    payableFindings: number;
    receivableFindings: number;
  };
};

export default function AuditoriaPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dreFile, setDreFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AuditAnalysisResult | null>(null);
  const [savedAudit, setSavedAudit] = useState<SavedAudit | null>(null);
  const [audits, setAudits] = useState<SavedAudit[]>([]);
  const [loading, setLoading] = useState(false);
  const [automaticLoading, setAutomaticLoading] = useState(false);
  const [automaticAnalysis, setAutomaticAnalysis] = useState<AutomaticAnalysis | null>(null);
  const [periodStart, setPeriodStart] = useState(() => currentMonthRange().start);
  const [periodEnd, setPeriodEnd] = useState(() => currentMonthRange().end);
  const [assignment, setAssignment] = useState<AssignmentState | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [checklistReview, setChecklistReview] = useState<ChecklistReviewState | null>(null);

  const isSupervisor = Boolean(bootstrap?.currentUser.canSupervise);

  const selectedClient = useMemo(
    () => bootstrap?.clients.find((client) => client.id === clientId) ?? null,
    [bootstrap?.clients, clientId],
  );

  async function load() {
    const [bootResponse, auditsResponse] = await Promise.all([
      fetch("/api/audit/bootstrap", { cache: "no-store" }),
      fetch("/api/audit", { cache: "no-store" }),
    ]);

    const boot = await bootResponse.json();
    const auditPayload = await auditsResponse.json();

    if (!bootResponse.ok) {
      throw new Error(boot.error || "Não foi possível carregar a auditoria.");
    }

    if (!auditsResponse.ok) {
      throw new Error(
        auditPayload.error || "Não foi possível carregar as auditorias.",
      );
    }

    setBootstrap(boot);
    setAudits(auditPayload.audits || []);
  }

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      load().catch((error) => {
        notifications.show({
          color: "red",
          title: "Auditoria",
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível carregar o módulo.",
        });
      });

    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, []);

  async function runAnalysis() {
    if (!clientId || !file) return;

    setLoading(true);

    try {
      const movements = await parseContaAzulMovements(file);
      const movementAnalysis = analyzeAuditMovements(movements);
      const dreAnalysis = dreFile
        ? analyzeContaAzulDre(await parseContaAzulDre(dreFile))
        : null;
      const result = combineAuditAnalyses(movementAnalysis, dreAnalysis);

      setAnalysis(result);

      const response = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          findings: result.findings,
          healthScore: result.healthScore,
          totalChecks: result.totalChecks,
          passedChecks: result.passedChecks,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
          metrics: result.metrics,
          referenceLabel: [
            ...new Set([
              ...result.metrics.months,
              ...(result.metrics.dreMonths ?? []),
            ]),
          ].sort().join(" → "),
          files: [
            {
              type: "MOVEMENTS",
              name: file.name,
              size: file.size,
              mimeType: file.type,
            },
            ...(dreFile ? [{
              type: "DRE",
              name: dreFile.name,
              size: dreFile.size,
              mimeType: dreFile.type,
              parsedSummary: dreAnalysis?.metrics,
            }] : []),
          ],
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error || "Não foi possível salvar a auditoria.",
        );
      }

      setSavedAudit(payload.audit);

      notifications.show({
        color: "green",
        title: "Auditoria concluída",
        message:
          `${result.movements.length} lançamentos e `
          + `${result.metrics.dreCategoryCount ?? 0} linhas da DRE analisados. `
          + `${result.findings.length} ponto(s) identificado(s).`,
      });

      await load();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Falha na auditoria",
        message: error instanceof Error ? error.message : "Erro inesperado.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function runContaAzulAnalysis() {
    if (!clientId || !periodStart || !periodEnd) return;
    setAutomaticLoading(true);
    setAnalysis(null);
    setAutomaticAnalysis(null);

    try {
      const response = await fetch("/api/audit/conta-azul", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, periodStart, periodEnd }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível executar a validação automática.");
      }
      setSavedAudit(payload.audit);
      setAutomaticAnalysis(payload.analysis);
      notifications.show({
        color: payload.audit.findings.length ? "blue" : "green",
        title: "Validação automática concluída",
        message: `${payload.analysis.metrics.historyItems} título(s) formaram o histórico e ${payload.audit.findings.length} apontamento(s) foram identificados.`,
      });
      await load();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Auditoria do Conta Azul",
        message: error instanceof Error ? error.message : "Erro inesperado.",
      });
    } finally {
      setAutomaticLoading(false);
    }
  }

  async function findingAction(
    id: string,
    action: string,
    body: Record<string, unknown> = {},
  ) {
    const response = await fetch(`/api/audit/findings/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        ...body,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload.error || "Não foi possível atualizar o apontamento.",
      );
    }

    await load();

    if (savedAudit) {
      const refreshResponse = await fetch("/api/audit", {
        cache: "no-store",
      });
      const refreshPayload = await refreshResponse.json();
      const refreshed = refreshPayload.audits?.find(
        (item: SavedAudit) => item.id === savedAudit.id,
      );

      if (refreshed) {
        setSavedAudit(refreshed);
      }
    }
  }

  async function checklistAction(
    id: string,
    body: {
      status: ChecklistReviewState["status"];
      note?: string;
      operatorId?: string | null;
      dueAt?: string | null;
    },
  ) {
    const response = await fetch(`/api/audit/checklist/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(
        payload.error || "Não foi possível salvar a revisão do checklist.",
      );
    }

    await load();

    if (savedAudit) {
      const refreshResponse = await fetch("/api/audit", {
        cache: "no-store",
      });
      const refreshPayload = await refreshResponse.json();

      const refreshed = refreshPayload.audits?.find(
        (item: SavedAudit) => item.id === savedAudit.id,
      );

      if (refreshed) {
        setSavedAudit(refreshed);
      }
    }

    notifications.show({
      color: body.status === "NON_COMPLIANT" ? "orange" : "green",
      title:
        body.status === "NON_COMPLIANT"
          ? "Correção direcionada"
          : "Checklist atualizado",
      message:
        body.status === "NON_COMPLIANT"
          ? "A não conformidade foi registrada e enviada ao operador."
          : "A revisão do líder foi salva.",
    });
  }

  function startNewAudit() {
    setClientId(null);
    setFile(null);
    setDreFile(null);
    setAnalysis(null);
    setAutomaticAnalysis(null);
    const range = currentMonthRange();
    setPeriodStart(range.start);
    setPeriodEnd(range.end);
    setSavedAudit(null);
    setAssignment(null);
    setActionModal(null);
    setChecklistReview(null);
  }

  function openChecklistReview(
    item: SavedAudit["checklist"][number],
    audit: SavedAudit,
  ) {
    const relatedFinding = audit.findings.find(
      (finding) => finding.ruleCode === `CHECKLIST:${item.id}`,
    );

    setChecklistReview({
      item,
      status: (item.status || "PENDING") as ChecklistReviewState["status"],
      note:
        item.note ||
        relatedFinding?.supervisorNote ||
        "",
      operatorId: relatedFinding?.operatorId || null,
      dueAt: relatedFinding?.dueAt
        ? relatedFinding.dueAt.slice(0, 10)
        : "",
    });
  }

  // A tela /auditoria representa somente a auditoria criada na sessão atual.
  // Auditorias anteriores permanecem salvas e são consultadas em /auditoria/andamento.
  const currentAudit = useMemo(
    () => savedAudit,
    [savedAudit],
  );

  if (!bootstrap) {
    return (
      <Stack p="lg">
        <Text>Carregando módulo de auditoria...</Text>
      </Stack>
    );
  }

  if (!isSupervisor) {
    return (
      <Stack gap="lg">
        <div>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>
            Auditoria
          </Text>
          <Title order={2}>Pendências de Auditoria</Title>
          <Text c="dimmed">
            Correções encaminhadas pela liderança, organizadas por cliente e
            auditoria.
          </Text>
          <Button component={Link} href="/auditoria/minhas" variant="light" mt="sm">
            Abrir Minhas Auditorias
          </Button>
        </div>

        {audits.length === 0 ? (
          <Alert color="blue">
            Você não possui apontamentos de auditoria atribuídos.
          </Alert>
        ) : (
          audits.map((audit) => (
            <Paper key={audit.id} withBorder radius="lg" p="lg">
              <Group justify="space-between" mb="md">
                <div>
                  <Title order={4}>{audit.client.name}</Title>
                  <Text size="sm" c="dimmed">
                    Auditoria de {formatDate(audit.createdAt)}
                  </Text>
                </div>

                <Badge variant="light">
                  {
                    audit.findings.filter(
                      (finding) =>
                        !["VALIDATED", "DISMISSED"].includes(finding.status),
                    ).length
                  }{" "}
                  pendentes
                </Badge>
              </Group>

              <Accordion variant="separated">
                {audit.findings.map((finding) => (
                  <Accordion.Item key={finding.id} value={finding.id}>
                    <Accordion.Control
                      icon={
                        <ThemeIcon
                          color={severityColor(finding.severity)}
                          variant="light"
                        >
                          <IconAlertTriangle size={16} />
                        </ThemeIcon>
                      }
                    >
                      <Group justify="space-between" pr="md">
                        <div>
                          <Text fw={700}>{finding.title}</Text>
                          <Text size="xs" c="dimmed">
                            {finding.subject ||
                              finding.category ||
                              "Apontamento"}
                          </Text>
                        </div>

                        <Badge
                          color={
                            finding.status === "VALIDATED"
                              ? "green"
                              : finding.status === "PENDING_VALIDATION"
                                ? "yellow"
                                : "blue"
                          }
                          variant="light"
                        >
                          {statusLabel(finding.status)}
                        </Badge>
                      </Group>
                    </Accordion.Control>

                    <Accordion.Panel>
                      <Stack gap="sm">
                        <Text size="sm">{finding.description}</Text>

                        {finding.supervisorNote && (
                          <Alert color="blue" title="Orientação do líder">
                            {finding.supervisorNote}
                          </Alert>
                        )}

                        <Group>
                          {["SENT", "RETURNED"].includes(finding.status) && (
                            <Button
                              size="xs"
                              onClick={() =>
                                findingAction(finding.id, "START")
                              }
                            >
                              {finding.status === "RETURNED"
                                ? "Retomar correção"
                                : "Iniciar correção"}
                            </Button>
                          )}

                          {finding.status === "IN_PROGRESS" && (
                            <Button
                              size="xs"
                              color="green"
                              onClick={() =>
                                setActionModal({
                                  finding,
                                  action: "COMPLETE",
                                  note: "",
                                })
                              }
                            >
                              Concluir e enviar para o líder
                            </Button>
                          )}
                        </Group>

                        {(finding.interactions?.length ?? 0) > 0 && (
                          <Stack gap={4}>
                            <Text size="xs" fw={700}>
                              Histórico
                            </Text>

                            {(finding.interactions ?? []).map((interaction) => (
                              <Text
                                key={interaction.id}
                                size="xs"
                                c="dimmed"
                              >
                                {interaction.user?.name ||
                                  interaction.user?.email ||
                                  "Usuário"}
                                : {interaction.action}
                                {interaction.note
                                  ? ` — ${interaction.note}`
                                  : ""}
                              </Text>
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                ))}
              </Accordion>
            </Paper>
          ))
        )}

        <Modal
          opened={!!actionModal}
          onClose={() => setActionModal(null)}
          title="Devolutiva da correção"
          centered
        >
          {actionModal && (
            <Stack>
              <Textarea
                label="O que foi feito?"
                required
                minRows={4}
                value={actionModal.note}
                onChange={(event) =>
                  setActionModal({
                    ...actionModal,
                    note: event.currentTarget.value,
                  })
                }
              />

              <Button
                disabled={!actionModal.note.trim()}
                onClick={async () => {
                  await findingAction(
                    actionModal.finding.id,
                    actionModal.action,
                    { note: actionModal.note },
                  );
                  setActionModal(null);
                }}
              >
                Enviar para o líder
              </Button>
            </Stack>
          )}
        </Modal>
      </Stack>
    );
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1}>
            Auditoria Inteligente
          </Text>
          <Title order={2}>Análise de Auditoria</Title>
          <Text c="dimmed">
            Foque impostos, folha, pró-labore e obrigações materiais, seguindo
            o fluxo Líder → Operador → Líder até o check final.
          </Text>
        </div>

        <Group>
          <Button component={Link} href="/auditoria/andamento" variant="default">
            Check das auditorias
          </Button>
          <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={startNewAudit}
        >
          Nova auditoria
        </Button>
        </Group>
      </Group>

      <Paper withBorder radius="lg" p="lg">
        <Group justify="space-between" align="flex-start" mb="md">
          <div>
            <Text fw={800}>Validação automática pelo Conta Azul</Text>
            <Text size="sm" c="dimmed">
              Aprende o histórico do início do ano ao mês anterior e separa os
              resultados entre Contas a Pagar e Contas a Receber.
            </Text>
          </div>
          <Badge
            color={selectedClient?.contaAzulConnection?.active
              && selectedClient.contaAzulConnection.status === "CONNECTED"
              ? "green"
              : "gray"}
            variant="light"
          >
            {selectedClient?.contaAzulConnection?.active
              && selectedClient.contaAzulConnection.status === "CONNECTED"
              ? "Conta Azul conectado"
              : "Selecione um cliente conectado"}
          </Badge>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 4 }}>
          <Select
            label="Cliente"
            placeholder="Selecione o cliente"
            searchable
            required
            data={bootstrap.clients.map((client) => ({ value: client.id, label: client.name }))}
            value={clientId}
            onChange={setClientId}
          />
          <TextInput
            type="date"
            label="Início do período"
            required
            value={periodStart}
            onChange={(event) => setPeriodStart(event.currentTarget.value)}
          />
          <TextInput
            type="date"
            label="Fim do período"
            required
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.currentTarget.value)}
          />
          <Button
            mt={25}
            loading={automaticLoading}
            disabled={!clientId || !periodStart || !periodEnd || automaticLoading}
            leftSection={<IconFileAnalytics size={18} />}
            onClick={runContaAzulAnalysis}
          >
            Iniciar validação
          </Button>
        </SimpleGrid>

        <Alert color="blue" mt="md" icon={<IconShieldCheck size={18} />}>
          PIX, transferências, tarifas, estornos e descrições genéricas continuam
          na conferência de títulos abertos ou vencidos, mas não criam padrão de
          recorrência. O histórico aprende impostos, folha, aluguel, contas de
          consumo, empréstimos e demais fornecedores ou clientes realmente recorrentes.
        </Alert>

        {automaticAnalysis && (
          <SimpleGrid cols={{ base: 2, md: 6 }} mt="md">
            <Metric title="Saúde" value={`${automaticAnalysis.healthScore}%`} color={automaticAnalysis.healthScore >= 80 ? "green" : automaticAnalysis.healthScore >= 60 ? "orange" : "red"} />
            <Metric title="Padrões aprendidos" value={automaticAnalysis.metrics.recurringProfiles} color="blue" />
            <Metric title="Recorrências ausentes" value={automaticAnalysis.metrics.missingRecurring} color="orange" />
            <Metric title="Vencidos" value={automaticAnalysis.metrics.overdue} color="red" />
            <Metric title="Em aberto" value={automaticAnalysis.metrics.open} color="yellow" />
            <Metric title="Competências" value={automaticAnalysis.metrics.competenceDivergences} color="violet" />
          </SimpleGrid>
        )}
      </Paper>

      <Paper withBorder radius="lg" p="lg">
        <Group mb="md">
          <div>
            <Text fw={800}>Análise complementar por relatórios</Text>
            <Text size="sm" c="dimmed">
              Use os PDFs quando precisar complementar a API com Movimentações e DRE.
            </Text>
          </div>
        </Group>
        <SimpleGrid cols={{ base: 1, md: 4 }}>
          <Select
            label="Cliente"
            placeholder="Selecione o cliente"
            searchable
            required
            data={bootstrap.clients.map((client) => ({
              value: client.id,
              label: client.name,
            }))}
            value={clientId}
            onChange={setClientId}
          />

          <div>
            <Text size="sm" fw={600} mb={6}>
              Extrato de Movimentações *
            </Text>

            <FileButton onChange={setFile} accept="application/pdf">
              {(props) => (
                <Button
                  {...props}
                  fullWidth
                  variant="default"
                  leftSection={<IconUpload size={16} />}
                >
                  {file ? file.name : "Selecionar PDF"}
                </Button>
              )}
            </FileButton>
          </div>

          <div>
            <Text size="sm" fw={600} mb={6}>
              DRE Gerencial
            </Text>

            <FileButton onChange={setDreFile} accept="application/pdf">
              {(props) => (
                <Button
                  {...props}
                  fullWidth
                  variant="default"
                  leftSection={<IconUpload size={16} />}
                >
                  {dreFile ? dreFile.name : "Selecionar PDF"}
                </Button>
              )}
            </FileButton>
            <Text size="xs" c="dimmed" mt={4}>
              Recomendada para comparar recorrências por competência.
            </Text>
          </div>

          <Button
            mt={25}
            disabled={!clientId || !file}
            loading={loading}
            onClick={runAnalysis}
            leftSection={<IconFileAnalytics size={18} />}
          >
            Executar auditoria
          </Button>
        </SimpleGrid>

        {!dreFile && (
          <Alert color="yellow" icon={<IconAlertTriangle size={16} />} mt="md">
            Sem a DRE, a auditoria usa somente o extrato. Água, energia,
            internet e demais recorrências ficam dependentes da revisão manual
            do líder.
          </Alert>
        )}
      </Paper>

      {analysis && (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Metric
              title="Saúde"
              value={`${analysis.healthScore}%`}
              color={
                analysis.healthScore >= 80
                  ? "green"
                  : analysis.healthScore >= 60
                    ? "orange"
                    : "red"
              }
            />
            <Metric
              title="Críticos"
              value={analysis.metrics.critical}
              color="red"
            />
            <Metric
              title="Atenções"
              value={analysis.metrics.warnings}
              color="orange"
            />
            <Metric
              title="Reports"
              value={analysis.findings.length}
              color="blue"
            />
          </SimpleGrid>

          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" align="flex-start" mb="md">
              <div>
                <Text fw={700}>Entradas e saídas analisadas</Text>
                <Text size="xs" c="dimmed">
                  Separação pelo sinal do valor identificado no extrato.
                </Text>
              </div>
              <Badge variant="light" color="gray">
                {analysis.metrics.sourceTransactionCount} no arquivo
              </Badge>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <Card withBorder radius="md" p="md">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  Entradas
                </Text>
                <Text fz={24} fw={800} c="green">
                  {analysis.metrics.entryCount}
                </Text>
                <Text size="sm" c="dimmed">
                  {formatMoney(analysis.metrics.entryTotal)}
                </Text>
              </Card>

              <Card withBorder radius="md" p="md">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  Saídas
                </Text>
                <Text fz={24} fw={800} c="red">
                  {analysis.metrics.exitCount}
                </Text>
                <Text size="sm" c="dimmed">
                  {formatMoney(analysis.metrics.exitTotal)}
                </Text>
              </Card>

              <Card withBorder radius="md" p="md">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  Movimentos prioritários
                </Text>
                <Text fz={24} fw={800} c="blue">
                  {analysis.metrics.priorityTransactionCount}
                </Text>
                <Text size="sm" c="dimmed">
                  Impostos, folha e pró-labore
                </Text>
              </Card>

              <Card withBorder radius="md" p="md">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  Desconsiderados
                </Text>
                <Text fz={24} fw={800} c="gray">
                  {analysis.metrics.compensatedTransactionCount
                    + analysis.metrics.genericIgnoredTransactionCount}
                </Text>
                <Text size="sm" c="dimmed">
                  {analysis.metrics.compensatedPairCount} par(es) e{" "}
                  {analysis.metrics.genericIgnoredTransactionCount} genérico(s)
                </Text>
              </Card>
            </SimpleGrid>

            {analysis.metrics.sourcesAnalyzed?.includes("DRE") && (
              <Alert color="green" icon={<IconCheck size={16} />} mt="md">
                DRE analisada em {analysis.metrics.dreMonths?.length ?? 0}
                {" "}competência(s), com {analysis.metrics.dreRecurringGroupsChecked ?? 0}
                {" "}grupo(s) recorrente(s) reconhecido(s) e {analysis.metrics.dreCategoryCount ?? 0}
                {" "}linha(s) lida(s).
              </Alert>
            )}

            {(analysis.metrics.compensatedPairCount > 0
              || analysis.metrics.genericIgnoredTransactionCount > 0) && (
              <Alert color="blue" icon={<IconCheck size={16} />} mt="md">
                Pares de entrada e saída do mesmo dia e valor, PIX sem
                identificação, recebimentos genéricos e transferências entre
                contas não geraram reports. Lançamentos prioritários e itens
                identificados permaneceram na análise.
              </Alert>
            )}
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" mb="xs">
              <Text fw={700}>Saúde da auditoria</Text>
              <Text fw={800}>{analysis.healthScore}%</Text>
            </Group>

            <Progress
              value={analysis.healthScore}
              color={
                analysis.healthScore >= 80
                  ? "green"
                  : analysis.healthScore >= 60
                    ? "orange"
                    : "red"
              }
              size="lg"
              radius="xl"
            />

            <Text size="xs" c="dimmed" mt="xs">
              {analysis.passedChecks} de {analysis.totalChecks} verificações
              automáticas sem apontamentos.
            </Text>
          </Paper>
        </>
      )}

      {currentAudit && (
        <SimpleGrid cols={{ base: 1, xl: 2 }}>
          <Paper withBorder radius="lg" p="lg">
            <Group mb="md">
              <ThemeIcon variant="light" color="blue">
                <IconClipboardCheck size={18} />
              </ThemeIcon>

              <div>
                <Text fw={700}>Relatórios e checklist</Text>
                <Text size="xs" c="dimmed">
                  Base analisada e validações manuais do líder
                </Text>
              </div>
            </Group>

            <Stack gap="sm">
              <Alert color="green" icon={<IconCheck size={16} />}>
                Extrato de Movimentações analisado
              </Alert>

              {currentAudit.files?.some((file) => file.type === "DRE") ? (
                <Alert color="green" icon={<IconCheck size={16} />}>
                  DRE Gerencial analisada e comparada por competência
                </Alert>
              ) : (
                <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                  DRE não enviada: recorrências devem ser confirmadas no checklist do líder
                </Alert>
              )}

              {(currentAudit.checklist ?? []).map((item) => {
                const relatedFinding = currentAudit.findings.find(
                  (finding) => finding.ruleCode === `CHECKLIST:${item.id}`,
                );

                return (
                  <Card key={item.id} withBorder radius="md" p="md">
                    <Group justify="space-between" align="flex-start" gap="sm">
                      <div style={{ flex: 1 }}>
                        <Text size="xs" c="dimmed">
                          {item.category}
                        </Text>

                        <Text size="sm" fw={700} mt={2}>
                          {item.title}
                        </Text>

                        {item.description && (
                          <Text size="xs" c="dimmed" mt={4}>
                            {item.description}
                          </Text>
                        )}

                        {item.note && (
                          <Text size="xs" c="dimmed" mt="xs">
                            <b>Observação:</b> {item.note}
                          </Text>
                        )}

                        <Group gap="xs" mt="sm">
                          <Badge
                            variant="light"
                            color={checklistStatusColor(item.status)}
                          >
                            {checklistStatusLabel(item.status)}
                          </Badge>

                          {relatedFinding && (
                            <Badge variant="outline" color="blue">
                              Correção: {statusLabel(relatedFinding.status)}
                            </Badge>
                          )}
                        </Group>
                      </div>

                      <Button
                        size="xs"
                        variant={item.status === "PENDING" ? "filled" : "light"}
                        onClick={() =>
                          openChecklistReview(item, currentAudit)
                        }
                      >
                        {item.status === "PENDING" ? "Revisar" : "Editar"}
                      </Button>
                    </Group>
                  </Card>
                );
              })}
            </Stack>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" mb="md">
              <div>
                <Text fw={700}>Reports identificados</Text>
                <Text size="xs" c="dimmed">
                  Revise os achados antes de enviar para correção.
                </Text>
              </div>
              <Badge variant="light">{currentAudit.findings.length}</Badge>
            </Group>

            <Stack gap="sm">
              {currentAudit.findings.length === 0 ? (
                <Alert color="green" icon={<IconShieldCheck size={18} />}>
                  Nenhum ponto de auditoria foi identificado pelas regras
                  atuais.
                </Alert>
              ) : (
                [...currentAudit.findings]
                  .sort((left, right) => {
                    const order = { PAYABLE: 0, RECEIVABLE: 1, GENERAL: 2 };
                    return order[left.flow || "GENERAL"] - order[right.flow || "GENERAL"];
                  })
                  .map((finding, index, sorted) => {
                    const flow = finding.flow || "GENERAL";
                    const previousFlow = index ? sorted[index - 1].flow || "GENERAL" : null;
                    const defaultOperatorId = flow === "PAYABLE"
                      ? currentAudit.client.payableResponsibleId
                      : flow === "RECEIVABLE"
                        ? currentAudit.client.receivableResponsibleId
                        : null;
                    return (
                  <Stack key={finding.id} gap="xs">
                    {flow !== previousFlow && (
                      <Group justify="space-between" mt={index ? "md" : 0}>
                        <Text fw={800} c={flow === "PAYABLE" ? "orange" : flow === "RECEIVABLE" ? "green" : "gray"}>
                          {flow === "PAYABLE" ? "Contas a Pagar" : flow === "RECEIVABLE" ? "Contas a Receber" : "Validações gerais"}
                        </Text>
                        <Badge variant="light" color={flow === "PAYABLE" ? "orange" : flow === "RECEIVABLE" ? "green" : "gray"}>
                          {sorted.filter((item) => (item.flow || "GENERAL") === flow).length}
                        </Badge>
                      </Group>
                    )}
                  <Card withBorder radius="md" p="md">
                    <Group justify="space-between" align="flex-start">
                      <div style={{ flex: 1 }}>
                        <Group gap="xs">
                          {flow !== "GENERAL" && (
                            <Badge color={flow === "PAYABLE" ? "orange" : "green"} variant="dot">
                              {flow === "PAYABLE" ? "A pagar" : "A receber"}
                            </Badge>
                          )}
                          <Badge
                            color={severityColor(finding.severity)}
                            variant="light"
                          >
                            {severityLabel(finding.severity)}
                          </Badge>
                          <Badge variant="outline" color="gray">
                            {statusLabel(finding.status)}
                          </Badge>
                        </Group>

                        <Text fw={700} mt="xs">
                          {finding.title}
                        </Text>
                        <Text size="sm" c="dimmed" mt={4}>
                          {finding.description}
                        </Text>

                        {Array.isArray(finding.evidence) && (
                          <Stack gap={2} mt="sm">
                            {finding.evidence.map((evidence, index) => (
                              <Text
                                key={`${finding.id}-evidence-${index}`}
                                size="xs"
                              >
                                <b>{evidence.label}:</b> {evidence.value}
                              </Text>
                            ))}
                          </Stack>
                        )}

                        {finding.supervisorNote && (
                          <Alert
                            mt="sm"
                            color="blue"
                            title="Orientação enviada"
                          >
                            {finding.supervisorNote}
                          </Alert>
                        )}
                      </div>
                    </Group>

                    <Group mt="md">
                      {finding.status === "IDENTIFIED" && (
                        <>
                          <Button
                            size="xs"
                            leftSection={<IconSend size={14} />}
                            onClick={() =>
                              setAssignment({
                                finding,
                                operatorId: defaultOperatorId || null,
                                note: "",
                                dueAt: "",
                              })
                            }
                          >
                            Enviar para operador
                          </Button>

                          <Button
                            size="xs"
                            variant="subtle"
                            color="gray"
                            onClick={() =>
                              setActionModal({
                                finding,
                                action: "DISMISS",
                                note: "",
                              })
                            }
                          >
                            Descartar
                          </Button>
                        </>
                      )}

                      {finding.status === "PENDING_VALIDATION" && (
                        <>
                          <Button
                            size="xs"
                            color="green"
                            onClick={() =>
                              findingAction(finding.id, "VALIDATE")
                            }
                          >
                            Validar correção
                          </Button>

                          <Button
                            size="xs"
                            color="orange"
                            variant="light"
                            onClick={() =>
                              setActionModal({
                                finding,
                                action: "RETURN",
                                note: "",
                              })
                            }
                          >
                            Devolver
                          </Button>
                        </>
                      )}
                    </Group>
                  </Card>
                  </Stack>
                    );
                  })
              )}
            </Stack>
          </Paper>
        </SimpleGrid>
      )}

      <Modal
        opened={!!checklistReview}
        onClose={() => setChecklistReview(null)}
        title="Revisar item do checklist"
        centered
        size="lg"
      >
        {checklistReview && (
          <Stack>
            <Paper withBorder radius="md" p="md">
              <Text size="xs" c="dimmed">
                {checklistReview.item.category}
              </Text>
              <Text fw={700} mt={2}>
                {checklistReview.item.title}
              </Text>
            </Paper>

            <Select
              label="Resultado da revisão"
              description="Defina o resultado da conferência feita pelo líder."
              required
              data={[
                { value: "COMPLIANT", label: "Conforme" },
                { value: "NON_COMPLIANT", label: "Não conforme" },
                { value: "NOT_APPLICABLE", label: "Não se aplica" },
              ]}
              value={
                checklistReview.status === "PENDING"
                  ? null
                  : checklistReview.status
              }
              onChange={(value) =>
                setChecklistReview({
                  ...checklistReview,
                  status:
                    (value as ChecklistReviewState["status"]) || "PENDING",
                })
              }
            />

            <Textarea
              label={
                checklistReview.status === "NON_COMPLIANT"
                  ? "Orientação do líder"
                  : "Observação da revisão"
              }
              description={
                checklistReview.status === "NON_COMPLIANT"
                  ? "Obrigatória. Explique o que foi identificado e direcione exatamente o que o operador deve conferir ou corrigir."
                  : "Registre contexto, evidências ou observações relevantes da conferência."
              }
              required={checklistReview.status === "NON_COMPLIANT"}
              minRows={4}
              value={checklistReview.note}
              onChange={(event) =>
                setChecklistReview({
                  ...checklistReview,
                  note: event.currentTarget.value,
                })
              }
            />

            {checklistReview.status === "NON_COMPLIANT" && (
              <>
                <Select
                  label="Operador responsável"
                  description="A não conformidade será criada na fila de correções deste operador."
                  required
                  searchable
                  data={bootstrap.operators.map((operator) => ({
                    value: operator.id,
                    label: operator.name,
                  }))}
                  value={checklistReview.operatorId}
                  onChange={(value) =>
                    setChecklistReview({
                      ...checklistReview,
                      operatorId: value,
                    })
                  }
                />

                <div>
                  <Text size="sm" fw={600} mb={6}>
                    Prazo para correção
                  </Text>
                  <input
                    type="date"
                    value={checklistReview.dueAt}
                    onChange={(event) =>
                      setChecklistReview({
                        ...checklistReview,
                        dueAt: event.currentTarget.value,
                      })
                    }
                    style={{
                      width: "100%",
                      padding: 10,
                      border: "1px solid #ced4da",
                      borderRadius: 8,
                    }}
                  />
                </div>

                <Alert color="blue">
                  Ao salvar como <b>Não conforme</b>, o sistema criará um
                  report com origem <b>Checklist do líder</b> e enviará
                  a orientação diretamente para o operador selecionado.
                </Alert>
              </>
            )}

            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setChecklistReview(null)}
              >
                Cancelar
              </Button>

              <Button
                color={
                  checklistReview.status === "NON_COMPLIANT"
                    ? "orange"
                    : "blue"
                }
                disabled={
                  checklistReview.status === "PENDING" ||
                  (checklistReview.status === "NON_COMPLIANT" &&
                    (!checklistReview.note.trim() ||
                      !checklistReview.operatorId ||
                      !checklistReview.dueAt))
                }
                onClick={async () => {
                  try {
                    await checklistAction(checklistReview.item.id, {
                      status: checklistReview.status,
                      note: checklistReview.note,
                      operatorId: checklistReview.operatorId,
                      dueAt: checklistReview.dueAt || null,
                    });
                    setChecklistReview(null);
                  } catch (error) {
                    notifications.show({
                      color: "red",
                      title: "Checklist",
                      message:
                        error instanceof Error
                          ? error.message
                          : "Não foi possível salvar a revisão.",
                    });
                  }
                }}
              >
                {checklistReview.status === "NON_COMPLIANT"
                  ? "Salvar e enviar para operador"
                  : "Salvar revisão"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={!!assignment}
        onClose={() => setAssignment(null)}
        title="Enviar para operador"
        centered
      >
        {assignment && (
          <Stack>
            <Select
              label="Operador responsável"
              required
              searchable
              data={bootstrap.operators.map((operator) => ({
                value: operator.id,
                label: operator.name,
              }))}
              value={assignment.operatorId}
              onChange={(value) =>
                setAssignment({
                  ...assignment,
                  operatorId: value,
                })
              }
            />

            <Textarea
              label="Orientação do líder"
              description="Obrigatória. Diga exatamente o que deve ser conferido/corrigido."
              required
              minRows={4}
              value={assignment.note}
              onChange={(event) =>
                setAssignment({
                  ...assignment,
                  note: event.currentTarget.value,
                })
              }
            />

            <input
              type="date"
              value={assignment.dueAt}
              onChange={(event) =>
                setAssignment({
                  ...assignment,
                  dueAt: event.currentTarget.value,
                })
              }
              style={{
                padding: 10,
                border: "1px solid #ced4da",
                borderRadius: 8,
              }}
            />

            <Button
              rightSection={<IconArrowRight size={16} />}
              disabled={
                !assignment.operatorId ||
                !assignment.note.trim() ||
                !assignment.dueAt
              }
              onClick={async () => {
                await findingAction(assignment.finding.id, "ASSIGN", {
                  operatorId: assignment.operatorId,
                  note: assignment.note,
                  dueAt: assignment.dueAt || null,
                });
                setAssignment(null);
              }}
            >
              Enviar para correção
            </Button>
          </Stack>
        )}
      </Modal>

      <Modal
        opened={!!actionModal}
        onClose={() => setActionModal(null)}
        title={
          actionModal?.action === "DISMISS"
            ? "Descartar apontamento"
            : "Devolver ao operador"
        }
        centered
      >
        {actionModal && (
          <Stack>
            <Textarea
              label="Observação"
              required
              minRows={4}
              value={actionModal.note}
              onChange={(event) =>
                setActionModal({
                  ...actionModal,
                  note: event.currentTarget.value,
                })
              }
            />

            <Button
              color={actionModal.action === "DISMISS" ? "gray" : "orange"}
              disabled={!actionModal.note.trim()}
              onClick={async () => {
                await findingAction(
                  actionModal.finding.id,
                  actionModal.action,
                  { note: actionModal.note },
                );
                setActionModal(null);
              }}
            >
              {actionModal.action === "DISMISS"
                ? "Confirmar descarte"
                : "Devolver para correção"}
            </Button>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function Metric({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color: string;
}) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between">
        <div>
          <Text size="xs" c="dimmed" fw={700} tt="uppercase">
            {title}
          </Text>
          <Text fz={28} fw={800}>
            {value}
          </Text>
        </div>

        <ThemeIcon size={42} radius="md" variant="light" color={color}>
          <IconAlertTriangle size={20} />
        </ThemeIcon>
      </Group>
    </Paper>
  );
}
