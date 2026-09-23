"use client";

import { useState } from "react";
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
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconRefresh,
  IconTrendingDown,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useDashboard } from "@/hooks/useDashboard";
import type { DashboardStatus } from "@/modules/dashboard/types/dashboard.types";
import type {
  DashboardPeriodCode,
  DashboardUsageKind,
} from "@/modules/dashboard/usage-analytics";
import styles from "./dashboard-page.module.css";

const statusLabels: Record<DashboardStatus, string> = {
  UPLOADED: "Enviado",
  PROCESSING: "Processando",
  REVIEW: "Em revisão",
  VALIDATED: "Validado",
  EXPORTED: "Exportado",
  FAILED: "Falhou",
};

const usageKindLabels: Record<DashboardUsageKind, string> = {
  EXCHANGE: "Conversão cambial",
  BANK_STATEMENT: "Importação de extrato",
  ACQUIRER: "Importação de adquirente",
  CREDIT_CARD_INVOICE: "Importação de fatura",
  BRASILMED_RECONCILIATION: "Conciliação BrasilMed",
  PURCHASE_INVOICE_IMPORT: "Entrada de nota de compra",
  CA_ACQUIRER: "Adquirente → Conta Azul",
  CA_CREDIT_CARD_INVOICE: "Fatura → Conta Azul",
  CA_PURCHASE_INVOICE: "Nota de compra → Conta Azul",
};

const periodOptions: Array<{ value: DashboardPeriodCode; label: string }> = [
  { value: "7D", label: "Últimos 7 dias" },
  { value: "30D", label: "Últimos 30 dias" },
  { value: "6M", label: "Últimos 6 meses" },
  { value: "12M", label: "Últimos 12 meses" },
];

function usageStatus(value: string) {
  return ({
    IMPORTED: "Importada",
    COMPLETED: "Concluído",
    PARTIAL: "Parcial",
    PROCESSING: "Processando",
    FAILED: "Falhou",
    EXPORTED: "Exportado",
    VALIDATED: "Validado",
    REVIEW: "Em revisão",
  } as Record<string, string>)[value] || statusLabels[value as DashboardStatus] || value;
}

function usageStatusColor(value: string, successful: boolean) {
  if (successful) return "green";
  if (value === "FAILED") return "red";
  if (value === "PARTIAL") return "orange";
  return "blue";
}

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

function formatAverage(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatBucket(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" })
      .format(new Date(`${value}T12:00:00Z`));
  }
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" })
    .format(new Date(`${value}-01T12:00:00Z`))
    .replace(" de ", "/");
}

export default function DashboardPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<DashboardPeriodCode>("30D");
  const { data, loading, error, reload } = useDashboard(period);

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
  const hasIntegratedUsage = hasImports || Boolean(data.access.PURCHASE_INVOICES);
  const maximumTimeline = Math.max(...data.usage.timeline.map((item) => item.total), 1);
  const maximumUsageType = Math.max(...data.usage.byType.map((item) => item.total), 1);
  const maximumClientUsage = Math.max(...data.usage.byClient.map((item) => item.total), 1);
  const maximumUserUsage = Math.max(...data.usage.byUser.map((item) => item.total), 1);

  const metrics = [
    ...(hasIntegratedUsage
      ? [
          {
            label: "Atividades hoje",
            value: data.usage.activitiesToday,
            detail: "Importações e integrações realizadas",
          },
          {
            label: "Importações",
            value: data.usage.imports,
            detail: data.period.label,
          },
          {
            label: "Envios ao Conta Azul",
            value: data.usage.caSends,
            detail: "Lotes concluídos ou parcialmente criados",
          },
          {
            label: "Lançamentos no CA",
            value: data.usage.caEntries,
            detail: "Títulos efetivamente criados",
          },
          {
            label: "Clientes movimentados",
            value: data.usage.clients,
            detail: "Com atividade no período",
          },
          {
            label: "Média diária",
            value: formatAverage(data.usage.dailyAverage),
            detail: `${formatAverage(data.usage.monthlyAverage)} atividades/mês`,
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
            Visão integrada das importações, notas de compra e lançamentos
            enviados pelo Fortuno Hub ao Conta Azul.
          </Text>
        </Stack>

        <Group align="flex-end">
          <Select
            label="Período dos indicadores"
            data={periodOptions}
            value={period}
            onChange={(value) => setPeriod((value as DashboardPeriodCode) || "30D")}
            allowDeselect={false}
            w={200}
          />
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            onClick={reload}
            loading={loading}
          >
            Atualizar
          </Button>
        </Group>
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

      {hasIntegratedUsage && (
        <>
          <Paper withBorder radius="lg" p="lg">
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Title order={3}>Movimento no Fortuno Hub</Title>
                  <Text size="sm" c="dimmed">
                    Quantidade diária ou mensal de importações e integrações,
                    conforme o período selecionado.
                  </Text>
                </Stack>
                <Group gap="xs">
                  <Badge variant="light" color="blue">{data.usage.imports} importações</Badge>
                  <Badge variant="light" color="green">{data.usage.caSends} envios ao CA</Badge>
                </Group>
              </Group>

              <ScrollArea type="auto" offsetScrollbars>
                <div className={styles.timelineChart}>
                  {data.usage.timeline.map((item) => (
                    <div
                      className={styles.timelineColumn}
                      key={item.key}
                      title={`${formatBucket(item.key)}: ${item.total} atividade(s), ${item.imports} importação(ões), ${item.caSends} envio(s) ao Conta Azul`}
                    >
                      <Text size="xs" fw={700} ta="center">{item.total}</Text>
                      <div className={styles.timelineTrack}>
                        <span style={{ height: `${Math.max(item.total ? 5 : 0, (item.total / maximumTimeline) * 100)}%` }} />
                      </div>
                      <Text size="xs" c="dimmed" ta="center" className={styles.timelineLabel}>
                        {formatBucket(item.key)}
                      </Text>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </Stack>
          </Paper>

          <SimpleGrid cols={{ base: 1, xl: 3 }} spacing="lg">
            <UsageRankingCard
              title="Uso por ferramenta"
              description="Importações e integrações realizadas no período."
              empty="Nenhuma ferramenta utilizada neste período."
              maximum={maximumUsageType}
              items={data.usage.byType.map((item) => ({
                ...item,
                label: usageKindLabels[item.key as DashboardUsageKind],
              }))}
            />
            <UsageRankingCard
              title="Uso por cliente"
              description="Clientes com maior movimentação no Fortuno Hub."
              empty="Nenhum cliente movimentado neste período."
              maximum={maximumClientUsage}
              items={data.usage.byClient}
            />
            <UsageRankingCard
              title={data.user.isTeamLeader ? "Produção da equipe" : "Produção por colaborador"}
              description="Atividades, envios e lançamentos por pessoa."
              empty="Nenhuma atividade registrada neste período."
              maximum={maximumUserUsage}
              items={data.usage.byUser}
            />
          </SimpleGrid>
        </>
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

      {hasIntegratedUsage && (
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
                  <Title order={4}>Atividades recentes</Title>
                  <Text size="sm" c="dimmed">
                    Importações, notas de compra e envios ao Conta Azul em uma única linha do tempo.
                  </Text>
                </Stack>
                <Badge variant="light">{data.usage.recent.length} recentes</Badge>
              </Group>

              {data.usage.recent.length === 0 ? (
                <Text c="dimmed" size="sm" py="xl" ta="center">
                  Nenhuma atividade registrada no período.
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
                        <Table.Th>Atividade</Table.Th>
                        <Table.Th>Cliente</Table.Th>
                        <Table.Th>Colaborador</Table.Th>
                        <Table.Th>Registros</Table.Th>
                        <Table.Th>Data</Table.Th>
                        <Table.Th>Status</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.usage.recent.map((item) => (
                        <Table.Tr key={item.id}>
                          <Table.Td>
                            <Text fw={600} size="sm" lineClamp={1}>
                              {usageKindLabels[item.kind]}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {item.stage === "CA_EXPORT" ? "Envio ao Conta Azul" : "Importação / processamento"}
                            </Text>
                          </Table.Td>
                          <Table.Td>{item.clientName || "Sem cliente"}</Table.Td>
                          <Table.Td>{item.userName}</Table.Td>
                          <Table.Td>{item.entries}</Table.Td>
                          <Table.Td>{formatDate(item.occurredAt)}</Table.Td>
                          <Table.Td>
                            <Badge color={usageStatusColor(item.status, item.successful)} variant="light" radius="sm">
                              {usageStatus(item.status)}
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
                  <Title order={4}>Volume processado</Title>
                  <Text size="sm" c="dimmed">
                    Valores importados e enviados durante {data.period.label.toLowerCase()}.
                  </Text>
                </Stack>
                <Stack gap={3}>
                  <Text size="xs" c="dimmed" fw={600}>VOLUME IMPORTADO</Text>
                  <Text fw={750} fz={28}>
                    {formatCurrency(data.usage.importedAmount)}
                  </Text>
                </Stack>
                <Divider />
                <Stack gap={2}>
                  <Text size="xs" c="dimmed">ENVIADO AO CONTA AZUL</Text>
                  <Text fw={700} fz={20}>{formatCurrency(data.usage.sentAmount)}</Text>
                  <Text size="xs" c="dimmed">
                    Os valores são exibidos por etapa e não são somados, evitando duplicar uma importação que depois foi enviada.
                  </Text>
                </Stack>
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

function UsageRankingCard({
  title,
  description,
  empty,
  maximum,
  items,
}: {
  title: string;
  description: string;
  empty: string;
  maximum: number;
  items: Array<{
    key: string;
    label: string;
    total: number;
    imports: number;
    caSends: number;
    caEntries: number;
  }>;
}) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="md">
        <Stack gap={1}>
          <Title order={4}>{title}</Title>
          <Text size="sm" c="dimmed">{description}</Text>
        </Stack>

        {items.length === 0 ? (
          <Text c="dimmed" size="sm" py="lg">{empty}</Text>
        ) : (
          items.slice(0, 8).map((item, index) => (
            <Stack key={item.key} gap={5}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge variant="light" color="gray">{index + 1}</Badge>
                  <Text size="sm" fw={650} truncate>{item.label}</Text>
                </Group>
                <Text size="sm" fw={800}>{item.total}</Text>
              </Group>
              <Progress value={(item.total / maximum) * 100} radius="xl" />
              <Group gap="xs">
                {item.imports > 0 && <Badge size="xs" variant="light" color="blue">{item.imports} import.</Badge>}
                {item.caSends > 0 && <Badge size="xs" variant="light" color="green">{item.caSends} envio(s)</Badge>}
                {item.caEntries > 0 && <Badge size="xs" variant="outline" color="teal">{item.caEntries} lançamento(s)</Badge>}
              </Group>
            </Stack>
          ))
        )}
      </Stack>
    </Paper>
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
