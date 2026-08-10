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

import { analyzeAuditMovements } from "@/modules/audit/engine";
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
  };
  clients: Array<{
    id: string;
    name: string;
    document?: string | null;
    operationLeaderId?: string | null;
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
  };
  findings: SavedFinding[];
  files: unknown[];
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
    PENDING_VALIDATION: "Aguardando validação",
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

export default function AuditoriaPage() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AuditAnalysisResult | null>(null);
  const [savedAudit, setSavedAudit] = useState<SavedAudit | null>(null);
  const [audits, setAudits] = useState<SavedAudit[]>([]);
  const [loading, setLoading] = useState(false);
  const [assignment, setAssignment] = useState<AssignmentState | null>(null);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [checklistReview, setChecklistReview] = useState<ChecklistReviewState | null>(null);

  const isSupervisor = ["MASTER", "ADMIN", "MANAGER"].includes(
    bootstrap?.currentUser.role || "",
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
  }, []);

  async function runAnalysis() {
    if (!clientId || !file) return;

    setLoading(true);

    try {
      const movements = await parseContaAzulMovements(file);
      const result = analyzeAuditMovements(movements);

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
          referenceLabel: result.metrics.months.join(" → "),
          file: {
            name: file.name,
            size: file.size,
            mimeType: file.type,
          },
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
        message: `${result.movements.length} lançamentos analisados e ${result.findings.length} pontos identificados.`,
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
          : "A revisão do supervisor foi salva.",
    });
  }

  function startNewAudit() {
    setClientId(null);
    setFile(null);
    setAnalysis(null);
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
            Correções encaminhadas pela supervisão, organizadas por cliente e
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
                          <Alert color="blue" title="Orientação do supervisor">
                            {finding.supervisorNote}
                          </Alert>
                        )}

                        <Group>
                          {finding.status === "SENT" && (
                            <Button
                              size="xs"
                              onClick={() =>
                                findingAction(finding.id, "START")
                              }
                            >
                              Iniciar correção
                            </Button>
                          )}

                          {["IN_PROGRESS", "RETURNED"].includes(
                            finding.status,
                          ) && (
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
                              Marcar como feito
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
                Enviar para validação
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
            Importe os relatórios, deixe o motor identificar padrões e
            direcione as correções ao operador.
          </Text>
        </div>

        <Group>
          <Button component={Link} href="/auditoria/andamento" variant="default">
            Auditorias em andamento
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
        <SimpleGrid cols={{ base: 1, md: 3 }}>
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
      </Paper>

      {analysis && (
        <>
          <SimpleGrid cols={{ base: 2, md: 5 }}>
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
              title="Observações"
              value={analysis.metrics.info}
              color="blue"
            />
            <Metric
              title="Lançamentos"
              value={analysis.metrics.transactionCount}
              color="gray"
            />
          </SimpleGrid>

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
                  Base analisada e validações manuais do supervisor
                </Text>
              </div>
            </Group>

            <Stack gap="sm">
              <Alert color="green" icon={<IconCheck size={16} />}>
                Extrato de Movimentações analisado
              </Alert>

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
                currentAudit.findings.map((finding) => (
                  <Card key={finding.id} withBorder radius="md" p="md">
                    <Group justify="space-between" align="flex-start">
                      <div style={{ flex: 1 }}>
                        <Group gap="xs">
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
                                operatorId: null,
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
                ))
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
              description="Defina o resultado da conferência feita pelo supervisor."
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
                  ? "Orientação do supervisor"
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
                  report com origem <b>Checklist do supervisor</b> e enviará
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
                      !checklistReview.operatorId))
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
              label="Orientação do supervisor"
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
              disabled={!assignment.operatorId || !assignment.note.trim()}
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