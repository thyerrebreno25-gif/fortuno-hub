"use client";

import { useMemo } from "react";
import { Badge, Card, Group, Paper, Progress, ScrollArea, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { buildAuditDashboard, type AuditDashboardLine } from "../core/audit-dashboard";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const percent = (value: number) => `${value.toFixed(2).replace(".", ",")}%`;

export function AcquirerAuditDashboard({
  lines,
  acquirer,
}: {
  lines: AuditDashboardLine[];
  acquirer: string;
}) {
  const data = useMemo(() => buildAuditDashboard(lines), [lines]);
  const maxBrand = Math.max(...data.byBrand.map((item) => item.gross), 1);
  const maxModality = Math.max(...data.byModality.map((item) => item.gross), 1);

  return (
    <Stack gap="lg">
      <Paper withBorder radius="lg" p="lg">
        <Group justify="space-between" mb="md">
          <Stack gap={2}>
            <Title order={4}>Dashboard executivo</Title>
            <Text size="sm" c="dimmed">Resumo da auditoria do arquivo atualmente processado.</Text>
          </Stack>
          <Badge variant="light">{acquirer}</Badge>
        </Group>

        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Card withBorder><Text size="xs" c="dimmed">Venda bruta</Text><Text fw={800} fz={20}>{money(data.gross)}</Text></Card>
          <Card withBorder><Text size="xs" c="dimmed">Taxas cobradas</Text><Text fw={800} fz={20} c="red">-{money(data.fees)}</Text></Card>
          <Card withBorder><Text size="xs" c="dimmed">Taxa média</Text><Text fw={800} fz={20}>{percent(data.averageRate)}</Text></Card>
          <Card withBorder><Text size="xs" c="dimmed">Operações auditadas</Text><Text fw={800} fz={20}>{data.salesCount}</Text></Card>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 2, md: 3 }} mt="md">
          <Card withBorder><Text size="xs" c="dimmed">Pago a maior</Text><Text fw={800} fz={20} c="red">{money(data.overpaid)}</Text></Card>
          <Card withBorder><Text size="xs" c="dimmed">Pago a menor</Text><Text fw={800} fz={20} c="green">{money(data.underpaid)}</Text></Card>
          <Card withBorder><Text size="xs" c="dimmed">Impacto líquido</Text><Text fw={800} fz={20} c={data.netImpact > 0 ? "red" : "green"}>{money(data.netImpact)}</Text></Card>
        </SimpleGrid>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        <Paper withBorder radius="lg" p="lg">
          <Title order={5} mb="md">Vendas por bandeira</Title>
          <Stack gap="md">
            {data.byBrand.map((item) => (
              <Stack key={item.label} gap={4}>
                <Group justify="space-between"><Text fw={700}>{item.label}</Text><Text size="sm">{money(item.gross)} • {item.count}</Text></Group>
                <Progress value={item.gross / maxBrand * 100} />
              </Stack>
            ))}
          </Stack>
        </Paper>

        <Paper withBorder radius="lg" p="lg">
          <Title order={5} mb="md">Vendas por modalidade</Title>
          <Stack gap="md">
            {data.byModality.map((item) => (
              <Stack key={item.label} gap={4}>
                <Group justify="space-between"><Text fw={700}>{item.label}</Text><Text size="sm">{money(item.gross)} • {item.count}</Text></Group>
                <Progress value={item.gross / maxModality * 100} />
              </Stack>
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>

      <SimpleGrid
        cols={{ base: 1, lg: 2 }}
        style={{ alignItems: "stretch" }}
      >
        <Paper
          withBorder
          radius="lg"
          p="lg"
          style={{ minWidth: 0, overflow: "hidden" }}
        >
          <Group justify="space-between" mb="md">
            <Title order={5}>Maiores divergências</Title>
            <Badge color={data.divergent ? "red" : "green"}>
              {data.divergent}
            </Badge>
          </Group>

          {data.divergences.length === 0 ? (
            <Text size="sm" c="dimmed">
              Nenhuma divergência encontrada.
            </Text>
          ) : (
            <ScrollArea type="auto" offsetScrollbars>
              <Table
                miw={660}
                verticalSpacing="sm"
                horizontalSpacing="md"
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Operação</Table.Th>
                    <Table.Th>Cobrada</Table.Th>
                    <Table.Th>Contratada</Table.Th>
                    <Table.Th ta="right">Impacto</Table.Th>
                  </Table.Tr>
                </Table.Thead>

                <Table.Tbody>
                  {data.divergences.slice(0, 10).map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Text fw={600} style={{ whiteSpace: "nowrap" }}>
                          {item.cardBrand || "—"} • {item.transactionType}
                        </Text>
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {percent(item.chargedRate ?? 0)}
                      </Table.Td>
                      <Table.Td style={{ whiteSpace: "nowrap" }}>
                        {percent(item.contractedRate ?? 0)}
                      </Table.Td>
                      <Table.Td
                        ta="right"
                        c={item.impact > 0 ? "red" : "green"}
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {money(item.impact)}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          )}
        </Paper>

        <Paper
          withBorder
          radius="lg"
          p="lg"
          style={{ minWidth: 0, overflow: "hidden" }}
        >
          <Group justify="space-between" mb="md">
            <Title order={5}>Regras pendentes</Title>
            <Badge color={data.notConfigured ? "orange" : "green"}>
              {data.notConfigured}
            </Badge>
          </Group>

          {data.pendingRules.length === 0 ? (
            <Text size="sm" c="dimmed">
              Todas as modalidades encontradas possuem regra cadastrada.
            </Text>
          ) : (
            <Stack gap="xs">
              {data.pendingRules.map((rule) => (
                <Card key={rule.key} withBorder padding="sm">
                  <Group justify="space-between">
                    <Text fw={700}>{rule.modality}</Text>
                    <Badge variant="outline">{rule.brand}</Badge>
                  </Group>
                </Card>
              ))}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
