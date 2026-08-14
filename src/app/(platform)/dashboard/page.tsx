"use client";

import {
  Alert,
  Badge,
  Button,
  Center,
  Divider,
  Group,
  Loader,
  Paper,
  Progress,
  ScrollArea,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/hooks/useDashboard";
import type {
  DashboardModule,
  DashboardStatus,
} from "@/modules/dashboard/types/dashboard.types";
import styles from "./dashboard-page.module.css";

const moduleLabels: Record<DashboardModule, string> = {
  EXCHANGE: "Câmbio",
  BANK_STATEMENT: "Extratos",
  ACQUIRER: "Adquirentes",
  CREDIT_CARD_INVOICE: "Faturas",
  BRASILMED_RECONCILIATION: "Conciliação",
};

const statusLabels: Record<DashboardStatus, string> = {
  UPLOADED: "Enviado",
  PROCESSING: "Processando",
  REVIEW: "Em revisão",
  VALIDATED: "Validado",
  EXPORTED: "Exportado",
  FAILED: "Falhou",
};

const statusColors: Record<DashboardStatus, string> = {
  UPLOADED: "gray",
  PROCESSING: "blue",
  REVIEW: "orange",
  VALIDATED: "cyan",
  EXPORTED: "green",
  FAILED: "red",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function DashboardPage() {
  const router = useRouter();
  const { data, loading, error, reload } = useDashboard();

  if (loading && !data) {
    return (
      <Center mih={420}>
        <Stack align="center" gap="sm">
          <Loader />
          <Text c="dimmed">Carregando Dashboard...</Text>
        </Stack>
      </Center>
    );
  }

  if (error && !data) {
    return (
      <Alert color="red" title="Não foi possível carregar o Dashboard">
        <Stack gap="md">
          <Text>{error}</Text>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            onClick={reload}
            w="fit-content"
          >
            Tentar novamente
          </Button>
        </Stack>
      </Alert>
    );
  }

  if (!data) return null;

  const maximumPerformance = Math.max(
    ...data.teamPerformance.map((item) => item.total),
    1,
  );

  const successRate =
    data.summary.processingsToday > 0
      ? Math.max(
          0,
          Math.round(
            ((data.summary.processingsToday - data.summary.failedProcessings) /
              data.summary.processingsToday) *
              100,
          ),
        )
      : 100;

  const hasImports = Boolean(data.access.IMPORTS || data.access.MOTOR_EXCHANGE);
  const operationRate =
    data.summary.pendingOperations + data.summary.completedOperationsToday > 0
      ? Math.round(
          (data.summary.completedOperationsToday /
            (data.summary.pendingOperations +
              data.summary.completedOperationsToday)) *
            100,
        )
      : 100;
  const onboardingRate = data.summary.activeOnboardings
    ? Math.max(
        0,
        Math.round(
          ((data.summary.activeOnboardings -
            data.summary.overdueOnboardings) /
            data.summary.activeOnboardings) *
            100,
        ),
      )
    : 100;

  const metrics = [
    ...(data.access.CLIENTS
      ? [{ label: "Clientes ativos", value: data.summary.activeClients, detail: `+${data.summary.newClientsThisMonth} no mês` }]
      : []),
    ...(hasImports
      ? [
          { label: "Processamentos hoje", value: data.summary.processingsToday, detail: "Módulos liberados" },
          { label: "Em processamento", value: data.summary.pendingProcessings, detail: "Aguardando revisão" },
          { label: "Falhas", value: data.summary.failedProcessings, detail: "Requerem atenção", tone: data.summary.failedProcessings > 0 ? "red" as const : undefined },
        ]
      : []),
    ...(data.access.OPERATIONS
      ? [
          { label: "Atividades pendentes", value: data.summary.pendingOperations, detail: `${data.summary.overdueOperations} de dias anteriores`, tone: data.summary.overdueOperations > 0 ? "red" as const : undefined },
          { label: "Concluídas hoje", value: data.summary.completedOperationsToday, detail: `${data.summary.operationHoursThisMonth}h no mês` },
        ]
      : []),
    ...(data.access.SERVICE_CENTER
      ? [{ label: "Novos e-mails", value: data.summary.newServiceEmails, detail: "Aguardando triagem", tone: data.summary.newServiceEmails > 0 ? "red" as const : undefined }]
      : []),
    ...(data.access.ONBOARDING
      ? [{ label: "Onboardings ativos", value: data.summary.activeOnboardings, detail: `${data.summary.overdueOnboardings} atrasado(s)` }]
      : []),
    ...(data.access.AUDIT
      ? [{ label: "Auditorias abertas", value: data.summary.activeAudits, detail: "Em acompanhamento" }]
      : []),
    ...(data.access.SUPPORT
      ? [{ label: "Suporte", value: data.summary.openTickets, detail: "Chamados abertos" }]
      : []),
  ];

  return (
    <Stack gap="lg" className={styles.page}>
      <Group
        justify="space-between"
        align="center"
        className={styles.pageHeader}
      >
        <Stack gap={2}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" lts={0.8}>
            Fortuno Hub
          </Text>
          <Title order={2}>Olá, {data.user.name}</Title>
          <Text size="sm" c="dimmed">
            Acompanhe a operação, importações e implantações em um só lugar.
          </Text>
        </Stack>

        <Group gap="sm">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconRefresh size={16} />}
            onClick={reload}
            loading={loading}
          >
            Atualizar
          </Button>

          {hasImports && (
            <Button
              leftSection={<IconUpload size={16} />}
              onClick={() => router.push("/extratos")}
            >
              Novo processamento
            </Button>
          )}
        </Group>
      </Group>

      {error && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
          {error} Os últimos dados carregados continuam visíveis.
        </Alert>
      )}

      <Paper withBorder radius="lg" p={0} style={{ overflow: "hidden" }}>
        <SimpleGrid
          cols={{ base: 1, sm: 2, md: 3, xl: Math.min(6, Math.max(1, metrics.length)) }}
          spacing={0}
          className={styles.metricsGrid}
        >
          {metrics.map((metric, index) => (
            <Metric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              detail={metric.detail}
              bordered={index > 0}
              tone={metric.tone}
            />
          ))}
        </SimpleGrid>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {hasImports && (
          <ModuleInsight
            title="Processamentos"
            description="Taxa de sucesso dos arquivos processados hoje."
            value={`${successRate}%`}
            detail={`${data.summary.failedProcessings} falha(s)`}
            progress={successRate}
            onOpen={() => router.push("/historico")}
          />
        )}
        {data.access.OPERATIONS && (
          <ModuleInsight
            title="Operação diária"
            description="Relação entre atividades concluídas hoje e a carga pendente."
            value={`${operationRate}%`}
            detail={`${data.summary.overdueOperations} atrasada(s)`}
            progress={operationRate}
            onOpen={() => router.push("/operacoes")}
            warning={data.summary.overdueOperations > 0}
          />
        )}
        {data.access.ONBOARDING && (
          <ModuleInsight
            title="Implantações no prazo"
            description="Saúde dos onboardings ativos da sua operação."
            value={`${onboardingRate}%`}
            detail={`${data.summary.onboardingHoursThisMonth}h apontadas`}
            progress={onboardingRate}
            onOpen={() => router.push("/onboarding")}
            warning={data.summary.overdueOnboardings > 0}
          />
        )}
        {data.access.SERVICE_CENTER && (
          <ModuleInsight
            title="Central de Atendimento"
            description="Novos e-mails aguardando leitura ou direcionamento."
            value={String(data.summary.newServiceEmails)}
            detail="novos e-mails"
            progress={data.summary.newServiceEmails > 0 ? 35 : 100}
            onOpen={() => router.push("/atendimento")}
            warning={data.summary.newServiceEmails > 0}
          />
        )}
      </SimpleGrid>

      {(hasImports || data.access.ONBOARDING) && (
      <SimpleGrid cols={{ base: 1, xl: 3 }} className={styles.primaryGrid}>
        {hasImports && (
        <Paper
          withBorder
          radius="lg"
          p="lg"
          className={styles.recentCard}
        >
          <Stack gap="md">
            <Group justify="space-between">
              <Stack gap={1}>
                <Title order={4}>Processamentos recentes</Title>
                <Text size="sm" c="dimmed">
                  Últimos arquivos registrados na operação.
                </Text>
              </Stack>
              <Button
                variant="subtle"
                rightSection={<IconArrowRight size={15} />}
                onClick={() => router.push("/historico")}
              >
                Ver histórico
              </Button>
            </Group>

            {data.recentProcessings.length === 0 ? (
              <Text c="dimmed" size="sm" py="xl" ta="center">
                Nenhum processamento encontrado.
              </Text>
            ) : (
              <ScrollArea>
                <Table
                  verticalSpacing="sm"
                  horizontalSpacing="md"
                  className={styles.recentTable}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Arquivo</Table.Th>
                      <Table.Th>Módulo</Table.Th>
                      <Table.Th>Cliente</Table.Th>
                      <Table.Th>Data</Table.Th>
                      <Table.Th>Status</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.recentProcessings.map((item) => (
                      <Table.Tr key={item.id}>
                        <Table.Td>
                          <Text fw={600} size="sm" lineClamp={1}>
                            {item.originalName}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {item.userName || "Usuário"}
                          </Text>
                        </Table.Td>
                        <Table.Td>{moduleLabels[item.module]}</Table.Td>
                        <Table.Td>{item.clientName || "Sem cliente"}</Table.Td>
                        <Table.Td>{formatDate(item.createdAt)}</Table.Td>
                        <Table.Td>
                          <Badge
                            color={statusColors[item.status]}
                            variant="light"
                            radius="sm"
                          >
                            {statusLabels[item.status]}
                          </Badge>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            )}
          </Stack>
        </Paper>
        )}

        <Stack gap="lg">
          {hasImports && (
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Stack gap={1}>
                <Title order={4}>Resumo financeiro</Title>
                <Text size="sm" c="dimmed">
                  Movimentações convertidas no mês.
                </Text>
              </Stack>

              <Stack gap={3}>
                <Text size="xs" c="dimmed" fw={600}>
                  VOLUME TOTAL
                </Text>
                <Text fw={750} fz={28}>
                  {formatCurrency(data.financialVolume.total)}
                </Text>
              </Stack>

              <Divider />

              <Group grow>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Créditos</Text>
                  <Text fw={700}>
                    {formatCurrency(data.financialVolume.credits)}
                  </Text>
                </Stack>
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">Débitos</Text>
                  <Text fw={700}>
                    {formatCurrency(data.financialVolume.debits)}
                  </Text>
                </Stack>
              </Group>
            </Stack>
          </Paper>
          )}

          {data.access.ONBOARDING && (
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Stack gap={1}>
                  <Title order={4}>Implantações</Title>
                  <Text size="sm" c="dimmed">Onboardings em andamento.</Text>
                </Stack>
                <Badge
                  color={data.summary.overdueOnboardings > 0 ? "red" : "green"}
                  variant="light"
                >
                  {data.summary.overdueOnboardings} atrasado(s)
                </Badge>
              </Group>

              <Group justify="space-between">
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">ATIVAS</Text>
                  <Text fw={750} fz={24}>
                    {data.summary.activeOnboardings}
                  </Text>
                </Stack>
                <Stack gap={2} align="flex-end">
                  <Text size="xs" c="dimmed">HORAS NO MÊS</Text>
                  <Text fw={750} fz={24}>
                    {data.summary.onboardingHoursThisMonth}h
                  </Text>
                </Stack>
              </Group>

              <Button
                variant="light"
                onClick={() => router.push("/onboarding")}
              >
                Abrir onboarding
              </Button>
            </Stack>
          </Paper>
          )}
        </Stack>
      </SimpleGrid>
      )}

      {hasImports && (
      <SimpleGrid cols={{ base: 1, xl: 2 }} className={styles.twoColumnGrid}>
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Stack gap={1}>
                <Title order={4}>Operação por módulo</Title>
                <Text size="sm" c="dimmed">
                  Distribuição dos processamentos de hoje.
                </Text>
              </Stack>
              <Badge variant="light">{successRate}% de sucesso</Badge>
            </Group>

            {data.processingsByModule.length === 0 ? (
              <Text c="dimmed" size="sm" py="lg">
                Nenhum processamento registrado hoje.
              </Text>
            ) : (
              <Stack gap="sm">
                {data.processingsByModule.map((item) => {
                  const percentage =
                    data.summary.processingsToday > 0
                      ? (item.total / data.summary.processingsToday) * 100
                      : 0;

                  return (
                    <Stack key={item.module} gap={5}>
                      <Group justify="space-between">
                        <Text size="sm" fw={600}>
                          {moduleLabels[item.module]}
                        </Text>
                        <Text size="sm" fw={700}>
                          {item.total}
                        </Text>
                      </Group>
                      <Progress value={percentage} radius="xl" />
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </Paper>

        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Stack gap={1}>
                <Title order={4}>Desempenho da equipe</Title>
                <Text size="sm" c="dimmed">
                  Processamentos realizados no mês.
                </Text>
              </Stack>
              <Button
                variant="subtle"
                rightSection={<IconArrowRight size={15} />}
                onClick={() => router.push("/relatorios")}
              >
                Relatórios
              </Button>
            </Group>

            {data.teamPerformance.length === 0 ? (
              <Text c="dimmed" size="sm" py="lg">
                Nenhum processamento no mês.
              </Text>
            ) : (
              <Stack gap="sm">
                {data.teamPerformance.map((item, index) => (
                  <Stack key={item.userId} gap={5}>
                    <Group justify="space-between">
                      <Group gap="sm">
                        <Badge variant="light" color="gray">
                          {index + 1}
                        </Badge>
                        <Text size="sm" fw={600}>
                          {item.name}
                        </Text>
                      </Group>
                      <Text size="sm" fw={700}>
                        {item.total}
                      </Text>
                    </Group>
                    <Progress
                      value={(item.total / maximumPerformance) * 100}
                      radius="xl"
                    />
                  </Stack>
                ))}
              </Stack>
            )}
          </Stack>
        </Paper>
      </SimpleGrid>
      )}

      {(data.access.HISTORY || data.access.SUPPORT) && (
      <SimpleGrid cols={{ base: 1, xl: 2 }} className={styles.twoColumnGrid}>
        {data.access.HISTORY && (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Title order={4}>Atividades recentes</Title>

            {data.recentActivities.length === 0 ? (
              <Text c="dimmed" size="sm">
                Nenhuma atividade registrada.
              </Text>
            ) : (
              <Stack gap={0}>
                {data.recentActivities.slice(0, 6).map((item, index) => (
                  <Group
                    key={item.id}
                    justify="space-between"
                    py="sm"
                    style={{
                      borderBottom:
                        index < Math.min(data.recentActivities.length, 6) - 1
                          ? "1px solid var(--mantine-color-gray-2)"
                          : undefined,
                    }}
                  >
                    <Stack gap={1}>
                      <Text size="sm" fw={600}>
                        {item.action}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {item.userName} · {formatDate(item.createdAt)}
                      </Text>
                    </Stack>
                    <Badge variant="light" color="gray">
                      {item.entity}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>
        </Paper>
        )}

        {data.access.SUPPORT && (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group justify="space-between">
              <Stack gap={1}>
                <Title order={4}>Suporte</Title>
                <Text size="sm" c="dimmed">Chamados mais recentes.</Text>
              </Stack>
              <Button
                variant="subtle"
                rightSection={<IconArrowRight size={15} />}
                onClick={() => router.push("/suporte")}
              >
                Abrir suporte
              </Button>
            </Group>

            {data.supportTickets.length === 0 ? (
              <Text c="dimmed" size="sm">
                Nenhum chamado encontrado.
              </Text>
            ) : (
              <Stack gap={0}>
                {data.supportTickets.slice(0, 5).map((ticket, index) => (
                  <Group
                    key={ticket.id}
                    justify="space-between"
                    py="sm"
                    style={{
                      borderBottom:
                        index < Math.min(data.supportTickets.length, 5) - 1
                          ? "1px solid var(--mantine-color-gray-2)"
                          : undefined,
                    }}
                  >
                    <Stack gap={1} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {ticket.subject}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {ticket.userName} · {formatDate(ticket.createdAt)}
                      </Text>
                    </Stack>
                    <Badge
                      color={
                        ticket.status === "RESOLVED" ||
                        ticket.status === "CLOSED"
                          ? "green"
                          : ticket.status === "IN_PROGRESS"
                            ? "orange"
                            : "blue"
                      }
                      variant="light"
                    >
                      {ticket.status}
                    </Badge>
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>
        </Paper>
        )}
      </SimpleGrid>
      )}
    </Stack>
  );
}

function Metric({
  label,
  value,
  detail,
  bordered = false,
  tone,
}: {
  label: string;
  value: number | string;
  detail: string;
  bordered?: boolean;
  tone?: "red" | "green";
}) {
  return (
    <Stack
      gap={3}
      p="lg"
      className={styles.metric}
      data-bordered={bordered || undefined}
    >
      <Text size="xs" c="dimmed" fw={600}>
        {label.toUpperCase()}
      </Text>
      <Text fw={750} fz={25} c={tone}>
        {value}
      </Text>
      <Text size="xs" c="dimmed">
        {detail}
      </Text>
    </Stack>
  );
}

function ModuleInsight({
  title,
  description,
  value,
  detail,
  progress,
  warning = false,
  onOpen,
}: {
  title: string;
  description: string;
  value: string;
  detail: string;
  progress: number;
  warning?: boolean;
  onOpen: () => void;
}) {
  return (
    <Paper
      withBorder
      radius="lg"
      p="lg"
      className={styles.insightCard}
      data-warning={warning || undefined}
      onClick={onOpen}
    >
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Text fw={750}>{title}</Text>
            <Text size="xs" c="dimmed">{description}</Text>
          </Stack>
          <Text fw={800} fz={27} c={warning ? "red" : "blue"}>{value}</Text>
        </Group>
        <div className={styles.insightTrack}>
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">{detail}</Text>
          <Text size="xs" fw={700} c="blue">Abrir módulo →</Text>
        </Group>
      </Stack>
    </Paper>
  );
}
