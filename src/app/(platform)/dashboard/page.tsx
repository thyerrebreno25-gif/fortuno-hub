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
  IconArrowRight,
  IconRefresh,
  IconTrendingDown,
  IconUsersGroup,
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

function formatRate(value: number | null) {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`;
}

function formatPoints(value: number | null) {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
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

  const hasImports = Boolean(data.access.IMPORTS || data.access.MOTOR_EXCHANGE);
  const maximumPerformance = Math.max(
    ...data.teamPerformance.map((item) => item.total),
    1,
  );
  const maximumModule = Math.max(
    ...data.processingsByModule.map((item) => item.total),
    1,
  );

  const metrics = [
    ...(hasImports
      ? [
          {
            label: "Exportações hoje",
            value: data.summary.exportsToday,
            detail: "Arquivos efetivamente gerados",
          },
          {
            label: "Exportações no mês",
            value: data.summary.exportsThisMonth,
            detail: "Somente arquivos concluídos",
          },
          {
            label: "Clientes no mês",
            value: data.summary.exportedClientsThisMonth,
            detail: "Com ao menos uma exportação",
          },
          {
            label: "Lançamentos exportados",
            value: data.summary.exportedTransactionsThisMonth,
            detail: "Registros convertidos no mês",
          },
        ]
      : []),
    ...(data.access.CLIENTS
      ? [
          {
            label: "Clientes visíveis",
            value: data.summary.activeClients,
            detail: data.user.isTeamLeader
              ? "Atendidos pela sua equipe"
              : "Base disponível para o perfil",
          },
        ]
      : []),
    ...(data.access.AUDIT
      ? [
          {
            label: "Auditorias ativas",
            value: data.summary.activeAudits,
            detail: "Em análise ou acompanhamento",
          },
        ]
      : []),
  ];

  return (
    <Stack gap="xl" className={styles.page}>
      <Group justify="space-between" align="flex-end" className={styles.pageHeader}>
        <Stack gap={4}>
          <Group gap="xs">
            <Text size="xs" fw={800} c="blue" tt="uppercase" lts={1.1}>
              Fortuno Hub
            </Text>
            {data.user.isTeamLeader && (
              <Badge
                color="blue"
                variant="light"
                leftSection={<IconUsersGroup size={12} />}
              >
                Visão da equipe · {data.user.visibleTeamSize} pessoas
              </Badge>
            )}
          </Group>
          <Title order={2}>Olá, {data.user.name}</Title>
          <Text c="dimmed">
            Indicadores alimentados somente quando um arquivo convertido é
            exportado pelas ferramentas financeiras.
          </Text>
        </Stack>

        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          onClick={reload}
          loading={loading}
        >
          Atualizar
        </Button>
      </Group>

      {metrics.length > 0 && (
        <Paper withBorder radius="lg" className={styles.metricsGrid}>
          {metrics.map((metric, index) => (
            <Metric
              key={metric.label}
              {...metric}
              bordered={index > 0}
            />
          ))}
        </Paper>
      )}

      {hasImports && (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="lg">
            <Group justify="space-between" align="flex-start">
              <Stack gap={2}>
                <Title order={3}>Comparativo de taxas por cliente</Title>
                <Text size="sm" c="dimmed" maw={800}>
                  Compara a média das taxas contratadas cadastradas para Cielo,
                  Getnet, Rede e Pagar.me. A menor média aparece como a condição
                  mais vantajosa dentro de cada adquirente.
                </Text>
              </Stack>
              <Badge variant="light" color="teal" size="lg">
                Adquirentes principais
              </Badge>
            </Group>

            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
              {data.acquirerComparison.map((comparison) => (
                <AcquirerComparisonCard
                  key={comparison.acquirer}
                  comparison={comparison}
                />
              ))}
            </SimpleGrid>

            <Text size="xs" c="dimmed">
              Adquirentes específicas, como iFood, GoodCard e similares, não
              entram neste ranking principal. O comparativo utiliza as taxas
              cadastradas em Clientes, não uma estimativa externa.
            </Text>
          </Stack>
        </Paper>
      )}

      {hasImports && (
        <SimpleGrid cols={{ base: 1, xl: 3 }} className={styles.primaryGrid}>
          <Paper
            withBorder
            radius="lg"
            p="lg"
            className={styles.recentCard}
          >
            <Stack gap="md">
              <Group justify="space-between">
                <Stack gap={1}>
                  <Title order={4}>Exportações recentes</Title>
                  <Text size="sm" c="dimmed">
                    Somente arquivos que chegaram à etapa final de exportação.
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
                  Nenhum arquivo exportado ainda.
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
                            <Badge color="green" variant="light" radius="sm">
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

          <Stack gap="lg">
            <Paper withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Stack gap={1}>
                  <Title order={4}>Volume convertido</Title>
                  <Text size="sm" c="dimmed">
                    Lançamentos presentes nos arquivos exportados no mês.
                  </Text>
                </Stack>
                <Stack gap={3}>
                  <Text size="xs" c="dimmed" fw={600}>VOLUME TOTAL</Text>
                  <Text fw={750} fz={28}>
                    {formatCurrency(data.financialVolume.total)}
                  </Text>
                </Stack>
                <Divider />
                <Group grow>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Créditos</Text>
                    <Text fw={700}>{formatCurrency(data.financialVolume.credits)}</Text>
                  </Stack>
                  <Stack gap={2}>
                    <Text size="xs" c="dimmed">Débitos</Text>
                    <Text fw={700}>{formatCurrency(data.financialVolume.debits)}</Text>
                  </Stack>
                </Group>
              </Stack>
            </Paper>

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
                      <Text size="xs" c="dimmed">ATIVOS</Text>
                      <Text fw={750} fz={24}>{data.summary.activeOnboardings}</Text>
                    </Stack>
                    <Stack gap={2} align="flex-end">
                      <Text size="xs" c="dimmed">HORAS NO MÊS</Text>
                      <Text fw={750} fz={24}>
                        {data.summary.onboardingHoursThisMonth}h
                      </Text>
                    </Stack>
                  </Group>
                  <Button variant="light" onClick={() => router.push("/onboarding")}>
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
              <Stack gap={1}>
                <Title order={4}>Exportações por ferramenta</Title>
                <Text size="sm" c="dimmed">
                  Distribuição dos arquivos exportados no mês.
                </Text>
              </Stack>
              {data.processingsByModule.length === 0 ? (
                <Text c="dimmed" size="sm" py="lg">
                  Nenhuma exportação registrada no mês.
                </Text>
              ) : (
                data.processingsByModule.map((item) => (
                  <Stack key={item.module} gap={5}>
                    <Group justify="space-between">
                      <Text size="sm" fw={600}>{moduleLabels[item.module]}</Text>
                      <Text size="sm" fw={700}>{item.total}</Text>
                    </Group>
                    <Progress value={(item.total / maximumModule) * 100} radius="xl" />
                  </Stack>
                ))
              )}
            </Stack>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Stack gap={1}>
                  <Title order={4}>
                    {data.user.isTeamLeader ? "Produção da equipe" : "Produção por colaborador"}
                  </Title>
                  <Text size="sm" c="dimmed">
                    Arquivos exportados no mês por pessoa visível para o perfil.
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
                <Text c="dimmed" size="sm" py="lg">Nenhuma exportação no mês.</Text>
              ) : (
                data.teamPerformance.map((item, index) => (
                  <Stack key={item.userId} gap={5}>
                    <Group justify="space-between">
                      <Group gap="sm">
                        <Badge variant="light" color="gray">{index + 1}</Badge>
                        <Text size="sm" fw={600}>{item.name}</Text>
                      </Group>
                      <Text size="sm" fw={700}>{item.total}</Text>
                    </Group>
                    <Progress value={(item.total / maximumPerformance) * 100} radius="xl" />
                  </Stack>
                ))
              )}
            </Stack>
          </Paper>
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
}: {
  label: string;
  value: number | string;
  detail: string;
  bordered?: boolean;
}) {
  return (
    <Stack
      gap={3}
      p="lg"
      className={styles.metric}
      data-bordered={bordered || undefined}
    >
      <Text size="xs" c="dimmed" fw={600}>{label.toUpperCase()}</Text>
      <Text fw={750} fz={25}>{value}</Text>
      <Text size="xs" c="dimmed">{detail}</Text>
    </Stack>
  );
}

function AcquirerComparisonCard({
  comparison,
}: {
  comparison: NonNullable<
    ReturnType<typeof useDashboard>["data"]
  >["acquirerComparison"][number];
}) {
  const enoughForComparison = comparison.clientsCount >= 2;

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="md">
        <Group justify="space-between">
          <Stack gap={0}>
            <Text fw={800} fz="lg">{comparison.label}</Text>
            <Text size="xs" c="dimmed">
              {comparison.clientsCount} cliente(s) com taxas cadastradas
            </Text>
          </Stack>
          {enoughForComparison ? (
            <Badge color="green" variant="light" leftSection={<IconTrendingDown size={12} />}>
              Menor: {formatRate(comparison.bestRate)}
            </Badge>
          ) : (
            <Badge color="gray" variant="light">Aguardando comparação</Badge>
          )}
        </Group>

        {comparison.clientsCount === 0 ? (
          <Text size="sm" c="dimmed" py="md">
            Nenhuma taxa cadastrada para esta adquirente.
          </Text>
        ) : (
          <>
            {enoughForComparison && (
              <SimpleGrid cols={3} spacing="xs">
                <Stack gap={1}>
                  <Text size="xs" c="dimmed">MAIS VANTAJOSO</Text>
                  <Text size="sm" fw={700}>{comparison.bestClientName}</Text>
                </Stack>
                <Stack gap={1}>
                  <Text size="xs" c="dimmed">MAIOR MÉDIA</Text>
                  <Text size="sm" fw={700}>{comparison.highestClientName}</Text>
                </Stack>
                <Stack gap={1}>
                  <Text size="xs" c="dimmed">DIFERENÇA</Text>
                  <Text size="sm" fw={800} c="orange">
                    +{formatPoints(comparison.spread)} p.p.
                  </Text>
                </Stack>
              </SimpleGrid>
            )}

            <Divider />
            <Stack gap="xs">
              {comparison.clients.map((client, index) => (
                <Group key={client.clientId} justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Badge variant="light" color={index === 0 ? "green" : "gray"}>
                      {index + 1}
                    </Badge>
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={650} truncate>{client.clientName}</Text>
                      <Text size="xs" c="dimmed">
                        {client.rateCount} taxa(s) cadastrada(s)
                      </Text>
                    </Stack>
                  </Group>
                  <Stack gap={0} align="flex-end">
                    <Text size="sm" fw={800}>{formatRate(client.averageRate)}</Text>
                    {client.deltaFromBest > 0 && (
                      <Text size="xs" c="orange">
                        +{formatPoints(client.deltaFromBest)} p.p.
                      </Text>
                    )}
                  </Stack>
                </Group>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}
