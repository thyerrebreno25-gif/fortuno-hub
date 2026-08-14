"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Accordion, ActionIcon, Alert, Badge, Button, Card, Checkbox, Divider, Drawer,
  Group, Modal, Paper, Progress, ScrollArea, Select, SimpleGrid, Stack, Tabs,
  Text, Textarea, TextInput, ThemeIcon, Timeline, Title, Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle, IconArrowRight, IconBuilding, IconCalendar, IconChartBar,
  IconCheck, IconClock, IconFileDescription, IconFlag, IconListCheck, IconMessage,
  IconPlayerPause, IconPlayerPlay, IconPlus, IconRocket, IconSearch, IconSettings,
  IconTemplate, IconTimeline, IconTrash, IconUser, IconUsers,
} from "@tabler/icons-react";
import { TemplateManager } from "@/components/onboarding/TemplateManager";
import { useOnboarding } from "@/hooks/useOnboarding";

const STANDARD_TEMPLATE_NAME = "Onboarding BPO Financeiro — Padrão";

type TaskStatus = "NOT_STARTED" | "IN_PROGRESS" | "WAITING_CLIENT" | "BLOCKED" | "COMPLETED" | "NOT_APPLICABLE";

type Task = {
  id: string;
  title: string;
  tip: string;
  status: TaskStatus;
  estimatedMinutes: number;
  trackedSeconds: number;
  runningSince?: string | null;
  comments: { author: string; text: string; date: string }[];
};

type Stage = {
  id: string;
  name: string;
  department: string;
  weight: number;
  tasks: Task[];
};

type Project = {
  id: string;
  companyName: string;
  tradeName: string;
  cnpj: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  responsible: string;
  supervisor: string;
  analystLead: string;
  team: string;
  startDate: string;
  expectedEndDate: string;
  status: "OPEN" | "IN_PROGRESS" | "COMPLETED";
  notes: string;
  createdAt: string;
  stages: Stage[];
};

const statusLabel: Record<TaskStatus, string> = {
  NOT_STARTED: "Não iniciada",
  IN_PROGRESS: "Em andamento",
  WAITING_CLIENT: "Aguardando cliente",
  BLOCKED: "Bloqueada",
  COMPLETED: "Concluída",
  NOT_APPLICABLE: "Não aplicável",
};

const statusColor: Record<TaskStatus, string> = {
  NOT_STARTED: "gray",
  IN_PROGRESS: "blue",
  WAITING_CLIENT: "orange",
  BLOCKED: "red",
  COMPLETED: "green",
  NOT_APPLICABLE: "gray",
};

const task = (id: string, title: string, tip: string, estimatedMinutes = 30): Task => ({
  id, title, tip, estimatedMinutes, trackedSeconds: 0, runningSince: null, status: "NOT_STARTED", comments: [],
});

const standardStages = (): Stage[] => [
  {
    id: "commercial", name: "Comercial e formalização", department: "Depto. Comercial", weight: 8,
    tasks: [
      task("commercial-data", "Coletar dados cadastrais e do responsável", "Solicite CNPJ, dados do responsável, contato financeiro, ramo, regime tributário e sistema atual.", 45),
      task("commercial-contract", "Elaborar e enviar contrato no D4Sign", "Validar pacote, cláusulas, testemunhas, datas e responsáveis antes do envio.", 45),
      task("commercial-signature", "Acompanhar assinatura até a conclusão", "Registrar cada contato realizado e manter a pendência atualizada.", 30),
      task("commercial-crm", "Conferir CRM e oficializar ganho", "Revise CNPJ, valor, data de fechamento, ramo, fonte e informações estratégicas.", 30),
      task("commercial-handoff", "Realizar passagem de bastão comercial", "O comercial deve transferir contexto, confiança, expectativas, riscos e promessas para a operação.", 60),
    ],
  },
  {
    id: "preparation", name: "Preparação pré-kickoff", department: "Depto. Gerencial I", weight: 8,
    tasks: [
      task("prep-kit", "Enviar guia de próximos passos e checklist", "Aproveite o momento após o fechamento para antecipar documentos, certificado e acessos.", 30),
      task("prep-contact", "Cadastrar contato no padrão da empresa", "Use o padrão [NOME E SOBRENOME] | [EMPRESA].", 10),
      task("prep-group", "Criar grupo BPO | Empresa e enviar boas-vindas", "Inclua logo, mensagem adaptada e contatos adicionais.", 20),
      task("prep-meeting", "Agendar 1ª reunião de onboarding", "Priorize formato presencial e inclua o comercial para a passagem de confiança.", 20),
      task("prep-schedule", "Elaborar cronograma de 30 dias", "Planeje 15 dias de parametrização e 15 dias de operação assistida e validação.", 40),
      task("prep-ca", "Mapear situação do Conta Azul", "Identifique se possui CA, se está em outro painel ou se utiliza outro controle.", 30),
    ],
  },
  {
    id: "kickoff", name: "1ª reunião de onboarding", department: "Depto. Gerencial I", weight: 7,
    tasks: [
      task("kickoff-prepare", "Preparar roteiro, documentos e dúvidas", "Revise negociação, sistemas informados e pendências antes da reunião.", 40),
      task("kickoff-map", "Mapear jornada financeira do cliente", "Documente fluxo de recebimentos, pagamentos, aprovações, sistemas e responsáveis.", 120),
      task("kickoff-window", "Definir janela de pagamentos", "Registre dias, horários, aprovadores, exceções e política de urgência.", 30),
      task("kickoff-expectations", "Registrar expectativas, dores e riscos", "Transforme expectativas em resultados esperados e riscos monitoráveis.", 30),
      task("kickoff-followup", "Enviar ata, combinados e pendências", "Consolide cronograma, acessos, documentos, responsáveis e próxima reunião.", 45),
    ],
  },
  {
    id: "access", name: "Acessos operacionais", department: "Depto. Gerencial I", weight: 14,
    tasks: [
      task("access-banks", "Solicitar e validar acessos bancários", "Teste saldo, extrato, DDA, aplicações e agendamento para cada banco.", 180),
      task("access-receipts", "Solicitar e validar meios de recebimento", "Mapeie adquirentes, plataformas, relatórios, taxas e periodicidade.", 120),
      task("access-systems", "Validar sistemas e controles atuais", "Teste acessos e registre limitações, dependências e responsáveis.", 90),
      task("access-docs", "Receber planilhas, contratos e documentos", "Confirme integridade dos arquivos e registre o que ainda está pendente.", 60),
      task("access-blocker", "Resolver gargalos técnicos", "Quando houver bloqueio, agende reunião rápida de 30 a 40 minutos e registre o histórico.", 60),
    ],
  },
  {
    id: "second-meeting", name: "2ª reunião e desenho dos processos", department: "Depto. Gerencial I", weight: 9,
    tasks: [
      task("second-analysis", "Apresentar análise dos sistemas e dúvidas", "Mostre riscos, controles paralelos, retrabalho e informações faltantes.", 90),
      task("second-ar", "Documentar processo de contas a receber", "Defina vendas, notas, boletos, contratos, cobrança, inadimplência e conciliação.", 120),
      task("second-ap", "Documentar processo de contas a pagar", "Defina envio, aprovação, janela, urgências, descrições, cartões e empréstimos.", 120),
      task("second-integrations", "Realizar integrações e ajustes iniciais", "Integre bancos, recebimentos, e-mail e ajuste saldos quando necessário.", 180),
    ],
  },
  {
    id: "management", name: "Análise gerencial", department: "Depto. Gerencial I", weight: 8,
    tasks: [
      task("mgmt-systems", "Analisar sistemas e estrutura financeira", "Avalie aderência, riscos, automações e oportunidades de melhoria.", 90),
      task("mgmt-chart", "Revisar plano de contas e categorias", "Identifique duplicidades, lacunas e necessidade de padronização.", 120),
      task("mgmt-dre", "Validar estrutura da DRE", "Confirme categorias, grupos e visão gerencial desejada.", 120),
      task("mgmt-advice", "Registrar recomendações consultivas", "Sugira bancos, plataformas, controles, indicadores e melhorias de processo.", 90),
    ],
  },
  {
    id: "ar", name: "Implantação de contas a receber", department: "Operação", weight: 13,
    tasks: [
      task("ar-methods", "Mapear e integrar meios de recebimento", "Cadastre adquirentes, acessos, taxas e integração com o sistema financeiro.", 180),
      task("ar-overdue", "Conferir contas vencidas e a vencer", "Valide carteira, documentos, responsáveis e divergências.", 120),
      task("ar-services", "Cadastrar serviços, contratos e recorrências", "Padronize nomes, vencimentos, valores e regras de faturamento.", 180),
      task("ar-billing", "Definir emissão de notas e boletos", "Registre particularidades fiscais, nomenclatura e canal de envio.", 90),
      task("ar-reconcile", "Realizar conciliação inicial", "Conciliar o mês de competência, tratar transferências, rendimentos e diferenças.", 240),
      task("ar-report", "Enviar relatório de inadimplência", "Solicite validação do cliente e registre o retorno.", 60),
    ],
  },
  {
    id: "ap", name: "Implantação de contas a pagar", department: "Operação", weight: 13,
    tasks: [
      task("ap-obligations", "Conferir obrigações, atrasos e previsões", "Mapeie contas, impostos, empréstimos, parcelamentos e recorrências.", 180),
      task("ap-operators", "Validar operadores e permissões bancárias", "Teste perfis e apoie o cliente na correção das pendências.", 120),
      task("ap-recurring", "Cadastrar gastos recorrentes", "Use o padrão definido, categorias e centros de custo.", 180),
      task("ap-punctual", "Cadastrar gastos pontuais", "Valide documentos, datas, categorias e aprovadores.", 120),
      task("ap-cards", "Mapear cartões e faturas", "Registre banco, bandeira, final, responsável, fechamento, vencimento e processo de envio.", 120),
    ],
  },
  {
    id: "payment-window", name: "Primeira janela de pagamentos", department: "Operação", weight: 10,
    tasks: [
      task("window-prepare", "Preparar e revisar títulos", "Confira documentos, vencimentos, categorias, contas e aprovadores.", 120),
      task("window-approval", "Enviar para aprovação e registrar retorno", "Mantenha evidência das aprovações e pendências.", 60),
      task("window-schedule", "Agendar pagamentos", "Valide conta, data, valor e favorecido antes de concluir.", 120),
      task("window-check", "Validar agendamentos e corrigir rejeições", "Revise todos os agendamentos e registre falhas e ajustes.", 90),
      task("window-feedback", "Coletar retorno do cliente", "Avalie clareza do fluxo, cumprimento da janela e pontos de melhoria.", 30),
    ],
  },
  {
    id: "stabilization", name: "Estabilização e resultados", department: "Gerencial + Operação", weight: 7,
    tasks: [
      task("stable-follow", "Acompanhar operação assistida", "Monitore contas a pagar, receber, conciliação e pendências após a primeira janela.", 240),
      task("stable-adjust", "Corrigir processos e documentação", "Atualize instruções, responsáveis e controles conforme os testes.", 120),
      task("stable-results", "Realizar reunião de apresentação de resultados", "Apresente diagnóstico, indicadores, melhorias, pendências e recomendações.", 120),
    ],
  },
  {
    id: "closure", name: "Encerramento e passagem operacional", department: "Gerencial", weight: 3,
    tasks: [
      task("close-report", "Preencher relatório descritivo final", "Consolide decisões, processos, acessos, riscos e pendências aceitas.", 90),
      task("close-handoff", "Realizar passagem para operadores fixos", "Garanta que responsáveis, substitutos e rotinas estejam definidos.", 60),
      task("close-approval", "Obter aceite gerencial e operacional", "Registre aceite interno e confirmação do cliente.", 30),
      task("close-client", "Criar cliente na base operacional", "Ao concluir 100%, gerar automaticamente cliente, bancos, cartões, adquirentes e configurações.", 15),
    ],
  },
];

const stageProgress = (stage: Stage) => {
  const applicable = stage.tasks.filter((t) => t.status !== "NOT_APPLICABLE");
  return applicable.length ? Math.round((applicable.filter((t) => t.status === "COMPLETED").length / applicable.length) * 100) : 0;
};

const projectProgress = (project: Project) => Math.round(project.stages.reduce((sum, stage) => sum + stageProgress(stage) * stage.weight, 0) / 100);
const taskElapsedSeconds = (task: Task, now = Date.now()) => task.trackedSeconds + (task.runningSince ? Math.max(0, Math.floor((now - new Date(task.runningSince).getTime()) / 1000)) : 0);
const trackedSeconds = (project: Project, now = Date.now()) => project.stages.flatMap((s) => s.tasks).reduce((sum, t) => sum + taskElapsedSeconds(t, now), 0);
const hoursLabel = (seconds = 0) => `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
const dateLabel = (value: string) => value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00`)) : "—";


const formatCnpj = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  return digits
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
};

const isValidCnpj = (value: string) => {
  const cnpj = value.replace(/\D/g, "");
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (length: number) => {
    let size = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += Number(cnpj[i]) * size--;
      if (size < 2) size = 9;
    }
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
};

const emptyForm = () => ({ companyName: "", tradeName: "", cnpj: "", contactName: "", contactPhone: "", contactEmail: "", responsible: "", supervisor: "", analystLead: "", team: "", startDate: new Date().toISOString().slice(0, 10), expectedEndDate: "", notes: "" });

export default function OnboardingPage() {
  const { templates, loading, error, refresh } = useOnboarding();
  const [activeTab, setActiveTab] = useState<string | null>("dashboard");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newOpened, setNewOpened] = useState(false);
  const [detail, setDetail] = useState<Project | null>(null);
  const [selectedTask, setSelectedTask] = useState<{ stageId: string; taskId: string } | null>(null);
  const [comment, setComment] = useState("");
  const [clockTick, setClockTick] = useState(Date.now());
  const [form, setForm] = useState(emptyForm());

  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      setProjectsLoading(true);
      setProjectsError(null);
      try {
        const response = await fetch("/api/onboarding/projects", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar as implantações.");
        let loadedProjects = Array.isArray(body.projects) ? body.projects : [];

        if (!loadedProjects.length) {
          const legacy = window.localStorage.getItem("conversos:onboarding-projects:v1");
          if (legacy) {
            try {
              const legacyProjects = JSON.parse(legacy);
              if (Array.isArray(legacyProjects) && legacyProjects.length) {
                const imported = [];
                for (const legacyProject of legacyProjects) {
                  const importResponse = await fetch("/api/onboarding/projects", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(legacyProject),
                  });
                  const importBody = await importResponse.json();
                  if (importResponse.ok && importBody.project) imported.push(importBody.project);
                }
                if (imported.length) {
                  loadedProjects = imported;
                  window.localStorage.removeItem("conversos:onboarding-projects:v1");
                }
              }
            } catch {
              // Mantém o dado legado no navegador quando a importação não puder ser concluída.
            }
          }
        }

        if (active) setProjects(loadedProjects);
      } catch (loadError) {
        if (active) setProjectsError(loadError instanceof Error ? loadError.message : "Erro ao carregar implantações.");
      } finally {
        if (active) setProjectsLoading(false);
      }
    };
    void loadProjects();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => projects.filter((p) => `${p.companyName} ${p.tradeName} ${p.cnpj} ${p.responsible}`.toLowerCase().includes(search.toLowerCase())), [projects, search]);
  const stats = useMemo(() => ({
    open: projects.filter((p) => p.status !== "COMPLETED").length,
    late: projects.filter((p) => p.status !== "COMPLETED" && p.expectedEndDate && new Date(p.expectedEndDate) < new Date()).length,
    blocked: projects.flatMap((p) => p.stages.flatMap((s) => s.tasks)).filter((t) => t.status === "BLOCKED").length,
    waiting: projects.flatMap((p) => p.stages.flatMap((s) => s.tasks)).filter((t) => t.status === "WAITING_CLIENT").length,
    avg: projects.length ? Math.round(projects.reduce((sum, p) => sum + projectProgress(p), 0) / projects.length) : 0,
    seconds: projects.reduce((sum, p) => sum + trackedSeconds(p, clockTick), 0),
  }), [projects, clockTick]);

  const saveProject = async () => {
    if (!form.companyName.trim() || !isValidCnpj(form.cnpj) || !form.contactName.trim() || !form.contactEmail.trim() || !form.supervisor.trim() || !form.analystLead.trim() || !form.team.trim() || !form.startDate) return;
    const end = form.expectedEndDate || new Date(new Date(`${form.startDate}T12:00:00`).getTime() + 30 * 86400000).toISOString().slice(0, 10);
    const project = {
      ...form,
      companyName: form.companyName.trim(),
      tradeName: form.tradeName.trim(),
      cnpj: formatCnpj(form.cnpj),
      expectedEndDate: end,
      status: "OPEN" as const,
      stages: standardStages(),
    };
    setSaving(true);
    setProjectsError(null);
    try {
      const response = await fetch("/api/onboarding/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível criar a implantação.");
      setProjects((current) => [body.project, ...current]);
      setForm(emptyForm());
      setNewOpened(false);
      setActiveTab("projects");
    } catch (saveError) {
      setProjectsError(saveError instanceof Error ? saveError.message : "Erro ao criar implantação.");
    } finally {
      setSaving(false);
    }
  };

  const updateProject = async (project: Project) => {
    const progress = projectProgress(project);
    const next = { ...project, status: progress === 100 ? "COMPLETED" as const : progress > 0 ? "IN_PROGRESS" as const : "OPEN" as const };
    setProjects((current) => current.map((p) => p.id === next.id ? next : p));
    setDetail(next);
    try {
      const response = await fetch(`/api/onboarding/projects/${next.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a implantação.");
      setProjects((current) => current.map((p) => p.id === body.project.id ? body.project : p));
      setDetail((current) => current?.id === body.project.id ? body.project : current);
    } catch (saveError) {
      setProjectsError(saveError instanceof Error ? saveError.message : "Erro ao salvar implantação.");
    }
  };

  const deleteProject = async (project: Project) => {
    const confirmed = window.confirm(
      `Excluir o onboarding de ${project.companyName}?\n\nAs tarefas e apontamentos deste onboarding serão removidos. O registro da exclusão permanecerá na auditoria.`,
    );
    if (!confirmed) return;

    setDeletingProjectId(project.id);
    setProjectsError(null);
    try {
      const response = await fetch(`/api/onboarding/projects/${project.id}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível excluir o onboarding.");
      }
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setDetail((current) => (current?.id === project.id ? null : current));
      setSelectedTask(null);
      await refresh();
    } catch (deleteError) {
      setProjectsError(
        deleteError instanceof Error
          ? deleteError.message
          : "Não foi possível excluir o onboarding.",
      );
    } finally {
      setDeletingProjectId(null);
    }
  };

  const mutateTask = (patch: Partial<Task>) => {
    if (!detail || !selectedTask) return;
    const next = structuredClone(detail) as Project;
    const stage = next.stages.find((s) => s.id === selectedTask.stageId);
    const current = stage?.tasks.find((t) => t.id === selectedTask.taskId);
    if (!current) return;
    Object.assign(current, patch);
    updateProject(next);
  };

  const activeTask = detail && selectedTask ? detail.stages.find((s) => s.id === selectedTask.stageId)?.tasks.find((t) => t.id === selectedTask.taskId) : null;

  const startTimer = () => {
    if (!activeTask || activeTask.runningSince) return;
    mutateTask({ runningSince: new Date().toISOString(), status: "IN_PROGRESS" });
  };

  const pauseTimer = () => {
    if (!activeTask?.runningSince) return;
    const extra = Math.max(0, Math.floor((Date.now() - new Date(activeTask.runningSince).getTime()) / 1000));
    mutateTask({ trackedSeconds: activeTask.trackedSeconds + extra, runningSince: null, status: "IN_PROGRESS" });
  };

  const finishTimer = () => {
    if (!activeTask) return;
    const extra = activeTask.runningSince ? Math.max(0, Math.floor((Date.now() - new Date(activeTask.runningSince).getTime()) / 1000)) : 0;
    mutateTask({ trackedSeconds: activeTask.trackedSeconds + extra, runningSince: null, status: "COMPLETED" });
  };

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Text size="xs" fw={800} c="blue" tt="uppercase">Central de implantação</Text>
          <Title order={2}>Onboarding</Title>
          <Text c="dimmed">O cliente nasce aqui. Acompanhe tarefas, gargalos, horas, progresso e a passagem para a operação.</Text>
        </Stack>
        <Button leftSection={<IconPlus size={17} />} onClick={() => setNewOpened(true)}>Novo onboarding</Button>
      </Group>

      {(error || projectsError) && <Alert color="red" icon={<IconAlertTriangle size={18} />}>{projectsError || error}</Alert>}
      {projectsLoading && <Alert color="blue" icon={<IconClock size={18} />}>Carregando implantações salvas no banco de dados...</Alert>}

      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tabs.List>
          <Tabs.Tab value="dashboard" leftSection={<IconChartBar size={16} />}>Dashboard</Tabs.Tab>
          <Tabs.Tab value="projects" leftSection={<IconRocket size={16} />}>Implantações</Tabs.Tab>
          <Tabs.Tab value="timeline" leftSection={<IconTimeline size={16} />}>Cronograma padrão</Tabs.Tab>
          <Tabs.Tab value="templates" leftSection={<IconTemplate size={16} />}>Templates</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="dashboard" pt="xl">
          <Stack gap="xl">
            <SimpleGrid cols={{ base: 1, sm: 2, xl: 6 }}>
              {[
                ["Em aberto", stats.open, IconRocket], ["Atrasados", stats.late, IconAlertTriangle], ["Bloqueadas", stats.blocked, IconFlag],
                ["Aguardando cliente", stats.waiting, IconUser], ["Conclusão média", `${stats.avg}%`, IconChartBar], ["Horas registradas", hoursLabel(stats.seconds), IconClock],
              ].map(([label, value, Icon]: any) => (
                <Paper key={label} withBorder radius="lg" p="lg"><Group justify="space-between"><Stack gap={2}><Text size="sm" c="dimmed">{label}</Text><Text fw={800} fz={28}>{value}</Text></Stack><ThemeIcon variant="light" size={40} radius="md"><Icon size={20} /></ThemeIcon></Group></Paper>
              ))}
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, lg: 3 }}>
              <Card withBorder radius="lg" p="xl" style={{ gridColumn: "span 2" }}>
                <Stack gap="lg">
                  <Group justify="space-between"><Stack gap={2}><Text fw={800} fz="lg">Onboardings ativos</Text><Text size="sm" c="dimmed">Visão rápida do andamento das implantações.</Text></Stack><Button variant="light" onClick={() => setActiveTab("projects")}>Ver todos</Button></Group>
                  {projects.slice(0, 5).map((p) => <Paper key={p.id} withBorder p="md" radius="md"><Group justify="space-between" align="center"><Stack gap={2} style={{ flex: 1 }}><Group><Text fw={700}>{p.companyName}</Text><Badge variant="light">{projectProgress(p)}%</Badge></Group><Progress value={projectProgress(p)} size="sm" radius="xl" /></Stack><Text size="sm" c="dimmed" ml="lg">Entrega {dateLabel(p.expectedEndDate)}</Text></Group></Paper>)}
                  {!projects.length && <Text c="dimmed">Nenhuma implantação iniciada. Crie o primeiro onboarding para testar o fluxo.</Text>}
                </Stack>
              </Card>
              <Card withBorder radius="lg" p="xl"><Stack gap="lg"><Text fw={800} fz="lg">Próximos passos</Text><Paper bg="blue.0" p="md" radius="md"><Text size="xs" fw={800} c="blue" tt="uppercase">Sugestão</Text><Text fw={700} mt={4}>{projects.length ? "Abra uma implantação e avance as primeiras tarefas." : "Crie o primeiro onboarding usando o template padrão."}</Text></Paper><Divider /><Text size="sm" c="dimmed">O onboarding só é concluído após operação assistida, apresentação de resultados, relatório final e passagem para os operadores fixos.</Text></Stack></Card>
            </SimpleGrid>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="projects" pt="xl">
          <Stack gap="lg">
            <Group justify="space-between"><TextInput leftSection={<IconSearch size={16} />} placeholder="Pesquisar empresa, CNPJ ou responsável" value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={{ base: "100%", sm: 420 }} /><Button leftSection={<IconPlus size={16} />} onClick={() => setNewOpened(true)}>Nova implantação</Button></Group>
            <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
              {filtered.map((p) => {
                const progress = projectProgress(p); const blocked = p.stages.flatMap((s) => s.tasks).filter((t) => t.status === "BLOCKED").length; const waiting = p.stages.flatMap((s) => s.tasks).filter((t) => t.status === "WAITING_CLIENT").length;
                return (
                  <Card key={p.id} withBorder radius="lg" p="xl">
                    <Stack gap="lg">
                      <Group justify="space-between">
                        <Group>
                          <ThemeIcon size={44} radius="md" variant="light"><IconBuilding size={22} /></ThemeIcon>
                          <Stack gap={0}>
                            <Text fw={800}>{p.companyName}</Text>
                            <Text size="sm" c="dimmed">{p.tradeName || p.cnpj || "Projeto de implantação"}</Text>
                          </Stack>
                        </Group>
                        <Badge color={p.status === "COMPLETED" ? "green" : "blue"}>
                          {p.status === "COMPLETED" ? "Concluído" : p.status === "IN_PROGRESS" ? "Em andamento" : "Não iniciado"}
                        </Badge>
                      </Group>
                      <Stack gap={7}>
                        <Group justify="space-between"><Text size="sm" fw={700}>Progresso</Text><Text size="sm" fw={800}>{progress}%</Text></Group>
                        <Progress value={progress} radius="xl" size="md" />
                      </Stack>
                      <SimpleGrid cols={3}>
                        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Prazo</Text><Text size="sm" fw={700}>{dateLabel(p.expectedEndDate)}</Text></Paper>
                        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Bloqueios</Text><Text fw={700}>{blocked}</Text></Paper>
                        <Paper withBorder p="sm"><Text size="xs" c="dimmed">Aguardando</Text><Text fw={700}>{waiting}</Text></Paper>
                      </SimpleGrid>
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed"><IconClock size={14} style={{ verticalAlign: "middle" }} /> {hoursLabel(trackedSeconds(p, clockTick))}</Text>
                        <Group gap={6}>
                          <ActionIcon
                            color="red"
                            variant="light"
                            loading={deletingProjectId === p.id}
                            onClick={() => void deleteProject(p)}
                            aria-label={`Excluir onboarding de ${p.companyName}`}
                            title="Excluir onboarding"
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                          <Button variant="subtle" rightSection={<IconArrowRight size={16} />} onClick={() => setDetail(p)}>Abrir onboarding</Button>
                        </Group>
                      </Group>
                    </Stack>
                  </Card>
                );
              })}
              {!filtered.length && <Paper withBorder p="xl" radius="lg"><Text c="dimmed">Nenhuma implantação encontrada.</Text></Paper>}
            </SimpleGrid>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="timeline" pt="xl">
          <Paper withBorder radius="lg" p="xl"><Stack gap="xl"><Stack gap={4}><Text fw={800} fz="lg">Cronograma padrão — 30 dias</Text><Text c="dimmed">As duas primeiras semanas são voltadas à parametrização; as duas últimas, à operação assistida, validação e entrega.</Text></Stack><Timeline active={4} bulletSize={34} lineWidth={3}><Timeline.Item bullet={<IconCalendar size={17} />} title="Semana 1 — Formalização, passagem de bastão e kickoff"><Text size="sm" c="dimmed">Dados, contrato, cobrança, preparação, primeira reunião e coleta antecipada.</Text></Timeline.Item><Timeline.Item bullet={<IconSettings size={17} />} title="Semana 2 — Acessos, integrações e desenho dos processos"><Text size="sm" c="dimmed">Bancos, recebimentos, sistemas, Conta Azul e segunda reunião.</Text></Timeline.Item><Timeline.Item bullet={<IconListCheck size={17} />} title="Semana 3 — Implantação operacional"><Text size="sm" c="dimmed">Contas a receber, contas a pagar, cartões, cadastros e conciliação inicial.</Text></Timeline.Item><Timeline.Item bullet={<IconCheck size={17} />} title="Semana 4 — Primeira janela, estabilização e encerramento"><Text size="sm" c="dimmed">Pagamentos, acompanhamento, resultados, relatório final e passagem operacional.</Text></Timeline.Item></Timeline></Stack></Paper>
        </Tabs.Panel>

        <Tabs.Panel value="templates" pt="xl">
          <Stack gap="xl">
            <Card withBorder radius="lg" p="xl">
              <Stack gap="lg">
                <Group justify="space-between" align="flex-start">
                  <Group align="flex-start">
                    <ThemeIcon size={48} radius="md" variant="light"><IconTemplate size={24} /></ThemeIcon>
                    <Stack gap={3}>
                      <Group gap="xs"><Text fw={900} fz="lg">{STANDARD_TEMPLATE_NAME}</Text><Badge color="blue" variant="light">Padrão do sistema</Badge><Badge color="gray" variant="light">Protegido</Badge></Group>
                      <Text size="sm" c="dimmed">Template oficial de implantação, com duração sugerida de 30 dias. Não pode ser alterado diretamente.</Text>
                    </Stack>
                  </Group>
                  <Button leftSection={<IconRocket size={16} />} onClick={() => setNewOpened(true)}>Usar template</Button>
                </Group>

                <SimpleGrid cols={{ base: 2, sm: 4 }}>
                  <Paper withBorder p="md" radius="md"><Text size="xs" c="dimmed">Etapas</Text><Text fw={900} fz="xl">{standardStages().length}</Text></Paper>
                  <Paper withBorder p="md" radius="md"><Text size="xs" c="dimmed">Atividades</Text><Text fw={900} fz="xl">{standardStages().reduce((sum, stage) => sum + stage.tasks.length, 0)}</Text></Paper>
                  <Paper withBorder p="md" radius="md"><Text size="xs" c="dimmed">Duração</Text><Text fw={900} fz="xl">30 dias</Text></Paper>
                  <Paper withBorder p="md" radius="md"><Text size="xs" c="dimmed">Peso total</Text><Text fw={900} fz="xl">100%</Text></Paper>
                </SimpleGrid>

                <Alert color="blue" icon={<IconCheck size={18} />}>
                  Este é o template aplicado automaticamente em todo novo onboarding. Ele contempla a coleta antecipada de documentos, participação do Comercial no kickoff, acessos detalhados, implantação de contas a receber e pagar, primeira janela, estabilização, apresentação de resultados, relatório final e handoff operacional.
                </Alert>

                <Accordion multiple variant="separated">
                  {standardStages().map((stage) => (
                    <Accordion.Item key={stage.id} value={`template-${stage.id}`}>
                      <Accordion.Control>
                        <Group justify="space-between" pr="md">
                          <Stack gap={0}><Text fw={800}>{stage.name}</Text><Text size="xs" c="dimmed">{stage.department} • peso {stage.weight}%</Text></Stack>
                          <Badge variant="light">{stage.tasks.length} atividades</Badge>
                        </Group>
                      </Accordion.Control>
                      <Accordion.Panel>
                        <Stack gap="xs">
                          {stage.tasks.map((item) => (
                            <Paper key={item.id} withBorder radius="md" p="md">
                              <Group align="flex-start" wrap="nowrap">
                                <ThemeIcon size="sm" radius="xl" variant="light"><IconCheck size={12} /></ThemeIcon>
                                <Stack gap={2}>
                                  <Text fw={700} size="sm">{item.title}</Text>
                                  <Text size="xs" c="dimmed">{item.tip}</Text>
                                  <Text size="xs" c="blue">Tempo previsto: {item.estimatedMinutes} min</Text>
                                </Stack>
                              </Group>
                            </Paper>
                          ))}
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  ))}
                </Accordion>
              </Stack>
            </Card>

            <Stack gap="sm">
              <Group justify="space-between"><Stack gap={2}><Text fw={900} fz="lg">Templates personalizados</Text><Text size="sm" c="dimmed">Duplique ou crie modelos próprios sem alterar o padrão oficial.</Text></Stack></Group>
              <TemplateManager templates={templates} loading={loading} onRefresh={refresh} />
            </Stack>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={newOpened} onClose={() => setNewOpened(false)} title="Novo onboarding" size="xl">
        <Stack gap="lg">
          <Alert color="blue" icon={<IconRocket size={18} />}>O projeto nasce aqui. Nenhum cliente precisa existir previamente na aba Clientes.</Alert>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <TextInput label="Razão social / empresa" required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.currentTarget.value })} />
            <TextInput label="Nome fantasia" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.currentTarget.value })} />
            <TextInput label="CNPJ" required placeholder="00.000.000/0000-00" value={form.cnpj} error={form.cnpj.replace(/\D/g, "").length === 14 && !isValidCnpj(form.cnpj) ? "CNPJ inválido" : undefined} description={isValidCnpj(form.cnpj) ? "CNPJ válido" : "Digite apenas os números; a máscara é aplicada automaticamente."} onChange={(e) => setForm({ ...form, cnpj: formatCnpj(e.currentTarget.value) })} />
            <TextInput label="Contato do cliente" required value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.currentTarget.value })} />
            <TextInput label="Telefone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.currentTarget.value })} />
            <TextInput label="E-mail" required value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.currentTarget.value })} />
            <TextInput label="Supervisor responsável" required value={form.supervisor} onChange={(e) => setForm({ ...form, supervisor: e.currentTarget.value })} />
            <TextInput label="Analista líder" required value={form.analystLead} onChange={(e) => setForm({ ...form, analystLead: e.currentTarget.value })} />
            <TextInput label="Time / equipe responsável" required placeholder="Ex.: Operação Financeira — Squad 2" value={form.team} onChange={(e) => setForm({ ...form, team: e.currentTarget.value })} />
            <TextInput label="Responsável principal do onboarding" value={form.responsible} onChange={(e) => setForm({ ...form, responsible: e.currentTarget.value })} />
            <Select label="Template" value="standard" data={[{ value: "standard", label: `${STANDARD_TEMPLATE_NAME} (30 dias)` }]} readOnly />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, md: 2 }}><TextInput type="date" label="Data de início" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.currentTarget.value })} /><TextInput type="date" label="Conclusão prevista" description="Vazio = 30 dias após o início" value={form.expectedEndDate} onChange={(e) => setForm({ ...form, expectedEndDate: e.currentTarget.value })} /></SimpleGrid>
          <Textarea label="Observações iniciais / passagem de bastão" minRows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setNewOpened(false)}>Cancelar</Button><Button disabled={!form.companyName.trim() || !isValidCnpj(form.cnpj) || !form.contactName.trim() || !form.contactEmail.trim() || !form.supervisor.trim() || !form.analystLead.trim() || !form.team.trim() || !form.startDate} loading={saving} onClick={() => void saveProject()}>Criar onboarding</Button></Group>
        </Stack>
      </Modal>

      <Drawer opened={Boolean(detail)} onClose={() => { setDetail(null); setSelectedTask(null); }} position="right" size="92%" title={detail ? `Onboarding • ${detail.companyName}` : "Onboarding"}>
        {detail && <Stack gap="xl"><SimpleGrid cols={{ base: 1, sm: 2, xl: 5 }}><Paper withBorder p="lg"><Text size="xs" c="dimmed">Progresso</Text><Text fw={800} fz={28}>{projectProgress(detail)}%</Text></Paper><Paper withBorder p="lg"><Text size="xs" c="dimmed">Início</Text><Text fw={700}>{dateLabel(detail.startDate)}</Text></Paper><Paper withBorder p="lg"><Text size="xs" c="dimmed">Entrega</Text><Text fw={700}>{dateLabel(detail.expectedEndDate)}</Text></Paper><Paper withBorder p="lg"><Text size="xs" c="dimmed">Supervisor</Text><Text fw={700}>{detail.supervisor || detail.responsible || "Não definido"}</Text><Text size="xs" c="dimmed">{detail.team || "Equipe não definida"}</Text></Paper><Paper withBorder p="lg"><Text size="xs" c="dimmed">Timesheet</Text><Text fw={700}>{hoursLabel(trackedSeconds(detail, clockTick))}</Text></Paper></SimpleGrid><Progress value={projectProgress(detail)} size="xl" radius="xl" />
          <Accordion multiple variant="separated" defaultValue={detail.stages.slice(0, 2).map((s) => s.id)}>
            {detail.stages.map((stage) => <Accordion.Item key={stage.id} value={stage.id}><Accordion.Control><Group justify="space-between" pr="md"><Stack gap={0}><Text fw={800}>{stage.name}</Text><Text size="xs" c="dimmed">{stage.department} • peso {stage.weight}%</Text></Stack><Badge variant="light">{stageProgress(stage)}%</Badge></Group></Accordion.Control><Accordion.Panel><Stack gap="sm">{stage.tasks.map((t) => <Paper key={t.id} withBorder radius="md" p="md"><Group justify="space-between" align="center"><Group align="flex-start" style={{ flex: 1 }}><Checkbox checked={t.status === "COMPLETED"} onChange={(e) => { const next = structuredClone(detail) as Project; const target = next.stages.find((s) => s.id === stage.id)?.tasks.find((x) => x.id === t.id); if (target) target.status = e.currentTarget.checked ? "COMPLETED" : "NOT_STARTED"; updateProject(next); }} mt={3} /><Stack gap={3}><Text fw={700}>{t.title}</Text><Group gap="xs"><Badge size="sm" color={statusColor[t.status]} variant="light">{statusLabel[t.status]}</Badge><Text size="xs" c="dimmed">Previsto {t.estimatedMinutes}min • Realizado {hoursLabel(taskElapsedSeconds(t, clockTick))}</Text></Group></Stack></Group><Button variant="subtle" onClick={() => setSelectedTask({ stageId: stage.id, taskId: t.id })}>Detalhes</Button></Group></Paper>)}</Stack></Accordion.Panel></Accordion.Item>)}
          </Accordion>
          {projectProgress(detail) === 100 && <Alert color="green" icon={<IconCheck size={18} />} title="Implantação concluída">O próximo passo será gerar o cliente operacional com os dados, bancos, cartões, adquirentes e configurações coletados no onboarding.</Alert>}
        </Stack>}
      </Drawer>

      <Drawer opened={Boolean(activeTask)} onClose={() => setSelectedTask(null)} position="right" size="lg" title="Detalhes da atividade" overlayProps={{ backgroundOpacity: 0.25 }}>
        {activeTask && <Stack gap="xl"><Stack gap={4}><Text fw={800} fz="lg">{activeTask.title}</Text><Badge color={statusColor[activeTask.status]} variant="light" w="fit-content">{statusLabel[activeTask.status]}</Badge></Stack><Paper withBorder p="lg" radius="md"><Group align="flex-start"><ThemeIcon variant="light"><IconFileDescription size={18} /></ThemeIcon><Stack gap={4}><Text fw={700}>Como executar</Text><Text size="sm" c="dimmed">{activeTask.tip}</Text></Stack></Group></Paper><Select label="Status" value={activeTask.status} data={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))} onChange={(value) => mutateTask({ status: (value || "NOT_STARTED") as TaskStatus })} /><SimpleGrid cols={2}><Paper withBorder p="md"><Text size="xs" c="dimmed">Tempo previsto</Text><Text fw={800}>{activeTask.estimatedMinutes} min</Text></Paper><Paper withBorder p="md"><Text size="xs" c="dimmed">Tempo realizado</Text><Text fw={900} fz={24}>{hoursLabel(taskElapsedSeconds(activeTask, clockTick))}</Text><Text size="xs" c={activeTask.runningSince ? "green" : "dimmed"}>{activeTask.runningSince ? "Cronômetro em execução" : "Cronômetro parado"}</Text></Paper></SimpleGrid><Group grow><Button leftSection={<IconPlayerPlay size={16} />} disabled={Boolean(activeTask.runningSince) || activeTask.status === "COMPLETED"} onClick={startTimer}>{activeTask.trackedSeconds > 0 ? "Continuar" : "Iniciar"}</Button><Button variant="default" leftSection={<IconPlayerPause size={16} />} disabled={!activeTask.runningSince} onClick={pauseTimer}>Pausar</Button><Button color="green" leftSection={<IconCheck size={16} />} disabled={activeTask.status === "COMPLETED"} onClick={finishTimer}>Finalizar</Button></Group><Divider label="Comentários e histórico" labelPosition="left" /><Stack gap="sm">{activeTask.comments.map((c, i) => <Paper key={i} withBorder p="md"><Group justify="space-between"><Text fw={700} size="sm">{c.author}</Text><Text size="xs" c="dimmed">{c.date}</Text></Group><Text size="sm" mt={5}>{c.text}</Text></Paper>)}{!activeTask.comments.length && <Text size="sm" c="dimmed">Nenhum comentário registrado.</Text>}</Stack><Textarea label="Novo comentário" placeholder="Ex.: acesso solicitado ao cliente em 30/07..." minRows={3} value={comment} onChange={(e) => setComment(e.currentTarget.value)} /><Button leftSection={<IconMessage size={16} />} disabled={!comment.trim()} onClick={() => { mutateTask({ comments: [...activeTask.comments, { author: "Usuário atual", text: comment.trim(), date: new Date().toLocaleString("pt-BR") }] }); setComment(""); }}>Adicionar comentário</Button></Stack>}
      </Drawer>
    </Stack>
  );
}
