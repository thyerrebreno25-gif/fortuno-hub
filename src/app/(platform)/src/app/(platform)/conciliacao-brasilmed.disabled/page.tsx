"use client";

import { useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  FileButton,
  Group,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBuildingCommunity,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconDownload,
  IconFileAnalytics,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUser,
  IconUsers,
  IconX,
} from "@tabler/icons-react";

type Status = "LINKED" | "NEW" | "REVIEW";

type Employee = {
  id: number;
  name: string;
  role: string;
  registration: string;
  cpf: string;
  department: string;
  amount: number;
  costCenter: string | null;
  status: Status;
};

const clients = [
  { value: "rede-sao-roque", label: "Rede São Roque" },
  { value: "fortuno", label: "Fortuno Gestão Financeira" },
  { value: "pl-servicos", label: "PL Serviços" },
  { value: "pl-logistica", label: "PL Logística" },
];

const settings = {
  "rede-sao-roque": {
    category: "Despesas com pessoal",
    centers: ["Operação", "Administrativo", "Financeiro", "Comercial"],
  },
  fortuno: {
    category: "Folha e benefícios",
    centers: ["Operação", "Administrativo", "Financeiro", "Tecnologia"],
  },
  "pl-servicos": {
    category: "Despesas com colaboradores",
    centers: ["Operação", "Administrativo", "Financeiro", "RH"],
  },
  "pl-logistica": {
    category: "Despesas com colaboradores",
    centers: ["Logística", "Operação", "Administrativo", "Financeiro"],
  },
} as const;

const initialEmployees: Employee[] = [
  {
    id: 1,
    name: "João da Silva",
    role: "Motorista",
    registration: "001245",
    cpf: "123.456.789-00",
    department: "Operações",
    amount: 2350.25,
    costCenter: "Operação",
    status: "LINKED",
  },
  {
    id: 2,
    name: "Maria de Souza",
    role: "Auxiliar Administrativo",
    registration: "001362",
    cpf: "987.654.321-00",
    department: "Administrativo",
    amount: 3250,
    costCenter: "Administrativo",
    status: "LINKED",
  },
  {
    id: 3,
    name: "Carlos Henrique Lima",
    role: "Supervisor",
    registration: "001517",
    cpf: "456.789.123-00",
    department: "Supervisão",
    amount: 4399.75,
    costCenter: null,
    status: "NEW",
  },
];

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const statusLabel: Record<Status, string> = {
  LINKED: "Vinculado",
  NEW: "Novo colaborador",
  REVIEW: "Revisar",
};

const statusColor: Record<Status, string> = {
  LINKED: "green",
  NEW: "blue",
  REVIEW: "orange",
};

export default function ConciliacaoPage() {
  const resetRef = useRef<() => void>(null);

  const [step, setStep] = useState<"upload" | "review">("upload");
  const [processing, setProcessing] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [documentTotal, setDocumentTotal] = useState<number | string>(10000);
  const [competenceDate, setCompetenceDate] = useState("2026-07-01");
  const [paymentDate, setPaymentDate] = useState("2026-07-10");
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [saveLinks, setSaveLinks] = useState(true);

  const client = clients.find((item) => item.value === clientId);
  const config =
    clientId && clientId in settings
      ? settings[clientId as keyof typeof settings]
      : null;

  const totals = useMemo(() => {
    const extracted = employees.reduce((sum, item) => sum + item.amount, 0);
    const pending = employees.filter((item) => !item.costCenter).length;
    const newEmployees = employees.filter((item) => item.status === "NEW").length;
    const linked = employees.filter((item) => item.status === "LINKED").length;
    const difference = extracted - Number(documentTotal || 0);
    const validated = Math.abs(difference) < 0.01;
    const health = Math.max(
      0,
      100 - pending * 12 - newEmployees * 4 - (validated ? 0 : 25),
    );

    return {
      extracted,
      pending,
      newEmployees,
      linked,
      difference,
      validated,
      health,
    };
  }, [employees, documentTotal]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return employees.filter((item) => {
      const matches =
        !term ||
        item.name.toLowerCase().includes(term) ||
        item.role.toLowerCase().includes(term) ||
        item.department.toLowerCase().includes(term);

      const pending = !onlyPending || !item.costCenter || item.status !== "LINKED";
      return matches && pending;
    });
  }, [employees, search, onlyPending]);

  function processFile() {
    if (!clientId || !file || !config) return;
    setProcessing(true);
    window.setTimeout(() => {
      setProcessing(false);
      setStep("review");
    }, 1200);
  }

  function updateEmployee(id: number, update: Partial<Employee>) {
    setEmployees((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  function removeEmployee(id: number) {
    setEmployees((current) => current.filter((item) => item.id !== id));
  }

  function resetPage() {
    setStep("upload");
    setClientId(null);
    setFile(null);
    setDocumentTotal(10000);
    setCompetenceDate("2026-07-01");
    setPaymentDate("2026-07-10");
    setEmployees(initialEmployees);
    setSearch("");
    setOnlyPending(false);
    setSaveLinks(true);
    resetRef.current?.();
  }

  const canExport =
    totals.validated &&
    totals.pending === 0 &&
    Boolean(competenceDate) &&
    Boolean(paymentDate);

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Text size="xs" fw={800} c="blue" tt="uppercase">
            Importações
          </Text>
          <Title order={2}>Conciliação</Title>
        </Stack>

        {step === "review" && (
          <Button
            variant="default"
            leftSection={<IconRefresh size={17} />}
            onClick={resetPage}
          >
            Nova conciliação
          </Button>
        )}
      </Group>

      {step === "upload" ? (
        <Paper withBorder radius="xl" p={{ base: "lg", md: 38 }}>
          <Stack gap="xl">
            <Center>
              <Stack align="center" gap="sm" maw={760}>
                <ThemeIcon size={68} radius="xl" variant="light">
                  <IconUsers size={34} />
                </ThemeIcon>
                <Title order={3} ta="center">
                  Importe o relatório para desmembramento
                </Title>
                <Text c="dimmed" ta="center">
                  O sistema extrairá nome, cargo, matrícula, CPF, departamento
                  e valor. Depois você revisará o centro de custo.
                </Text>
              </Stack>
            </Center>

            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Select
                label="Cliente"
                description="A categoria e os centros de custo virão do cadastro."
                placeholder="Selecione o cliente"
                data={clients}
                value={clientId}
                onChange={setClientId}
                searchable
                clearable
                leftSection={<IconUser size={17} />}
                required
              />

              <NumberInput
                label="Valor total do pagamento"
                description="Valor consolidado que será desmembrado."
                value={documentTotal}
                onChange={setDocumentTotal}
                prefix="R$ "
                decimalScale={2}
                fixedDecimalScale
                thousandSeparator="."
                decimalSeparator=","
                required
              />
            </SimpleGrid>

            {clientId && config && (
              <Paper withBorder radius="lg" p="lg">
                <Group justify="space-between">
                  <Group>
                    <ThemeIcon variant="light" size={44} radius="md">
                      <IconBuildingCommunity size={23} />
                    </ThemeIcon>
                    <Stack gap={1}>
                      <Text fw={800}>Configuração carregada</Text>
                      <Text size="sm" c="dimmed">
                        {client?.label}
                      </Text>
                    </Stack>
                  </Group>
                  <Badge color="blue" variant="light">
                    {config.category}
                  </Badge>
                </Group>
              </Paper>
            )}

            <Paper
              withBorder
              radius="xl"
              p={38}
              style={{ borderStyle: "dashed" }}
            >
              <Stack align="center" gap="md">
                <ThemeIcon variant="light" size={54} radius="xl">
                  <IconUpload size={27} />
                </ThemeIcon>
                <Text fw={800} fz="lg">
                  Envie o relatório em PDF
                </Text>
                <FileButton
                  resetRef={resetRef}
                  onChange={setFile}
                  accept=".pdf,application/pdf"
                >
                  {(props) => (
                    <Button {...props} leftSection={<IconUpload size={18} />}>
                      Selecionar PDF
                    </Button>
                  )}
                </FileButton>
              </Stack>
            </Paper>

            {file && (
              <Card withBorder radius="lg">
                <Group justify="space-between">
                  <Group>
                    <ThemeIcon variant="light" size={44} radius="md">
                      <IconFileAnalytics size={23} />
                    </ThemeIcon>
                    <Stack gap={1}>
                      <Text fw={700}>{file.name}</Text>
                      <Text size="sm" c="dimmed">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </Text>
                    </Stack>
                  </Group>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      setFile(null);
                      resetRef.current?.();
                    }}
                  >
                    <IconX size={18} />
                  </ActionIcon>
                </Group>
              </Card>
            )}

            <Alert color="blue">
              Não é necessário informar se o pagamento é folha, férias,
              rescisão ou outro tipo. O módulo apenas extrai e desmembra os
              valores encontrados.
            </Alert>

            <Group justify="flex-end">
              <Button
                disabled={!clientId || !file || !documentTotal}
                loading={processing}
                onClick={processFile}
                rightSection={<IconChevronRight size={18} />}
              >
                Extrair informações
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
            <Paper withBorder radius="lg" p="lg">
              <Text size="sm" c="dimmed">Cliente</Text>
              <Text fw={800} fz={20}>{client?.label}</Text>
              <Badge mt="sm" color="blue" variant="light">
                Configuração carregada
              </Badge>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Text size="sm" c="dimmed">Colaboradores</Text>
              <Text fw={800} fz={28}>{employees.length}</Text>
              <Text size="sm" c="dimmed">{totals.newEmployees} novo(s)</Text>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Text size="sm" c="dimmed">Total extraído</Text>
              <Text fw={800} fz={24}>{money(totals.extracted)}</Text>
              <Badge
                mt="sm"
                color={totals.validated ? "green" : "orange"}
                variant="light"
              >
                {totals.validated ? "Validado" : "Divergente"}
              </Badge>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Group justify="space-between">
                <Stack gap={2}>
                  <Text size="sm" c="dimmed">Saúde da extração</Text>
                  <Text fw={800} fz={25}>{totals.health}%</Text>
                </Stack>
                <Badge
                  color={totals.health >= 90 ? "green" : "orange"}
                  variant="light"
                >
                  {totals.health >= 90 ? "Excelente" : "Revisar"}
                </Badge>
              </Group>
              <Progress mt="md" value={totals.health} radius="xl" />
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, xl: 2 }}>
            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Title order={4}>Conferência do pagamento</Title>
                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <Card withBorder>
                    <Text size="xs" c="dimmed">Total informado</Text>
                    <Text fw={800}>{money(Number(documentTotal || 0))}</Text>
                  </Card>
                  <Card withBorder>
                    <Text size="xs" c="dimmed">Total extraído</Text>
                    <Text fw={800}>{money(totals.extracted)}</Text>
                  </Card>
                  <Card withBorder>
                    <Text size="xs" c="dimmed">Diferença</Text>
                    <Text fw={800} c={totals.validated ? "green" : "orange"}>
                      {money(totals.difference)}
                    </Text>
                  </Card>
                </SimpleGrid>
                <Alert
                  color={totals.validated ? "green" : "orange"}
                  icon={
                    totals.validated ? (
                      <IconCheck size={18} />
                    ) : (
                      <IconAlertTriangle size={18} />
                    )
                  }
                >
                  {totals.validated
                    ? "A soma dos valores extraídos confere com o pagamento."
                    : "Existe diferença entre o total informado e o extraído."}
                </Alert>
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Title order={4}>Dados para o Conta Azul</Title>
                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                  <TextInput
                    label="Data de competência"
                    type="date"
                    value={competenceDate}
                    onChange={(event) =>
                      setCompetenceDate(event.currentTarget.value)
                    }
                    leftSection={<IconCalendar size={17} />}
                  />
                  <TextInput
                    label="Data de pagamento"
                    type="date"
                    value={paymentDate}
                    onChange={(event) =>
                      setPaymentDate(event.currentTarget.value)
                    }
                    leftSection={<IconCalendar size={17} />}
                  />
                </SimpleGrid>
                <Card withBorder>
                  <Text size="xs" c="dimmed">Categoria do cliente</Text>
                  <Text fw={800}>{config?.category}</Text>
                </Card>
              </Stack>
            </Paper>
          </SimpleGrid>

          <Paper withBorder radius="lg">
            <Group justify="space-between" p="lg" align="flex-end">
              <Stack gap={2}>
                <Title order={4}>Colaboradores extraídos</Title>
                <Text size="sm" c="dimmed">
                  Preencha o centro de custo dos novos colaboradores.
                </Text>
              </Stack>
              <Group>
                <Checkbox
                  checked={onlyPending}
                  onChange={(event) =>
                    setOnlyPending(event.currentTarget.checked)
                  }
                  label="Somente pendências"
                />
                <TextInput
                  placeholder="Buscar colaborador"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  leftSection={<IconSearch size={17} />}
                />
              </Group>
            </Group>

            <ScrollArea>
              <Table miw={1250} verticalSpacing="sm" horizontalSpacing="md">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Colaborador</Table.Th>
                    <Table.Th>Cargo</Table.Th>
                    <Table.Th>Matrícula</Table.Th>
                    <Table.Th>CPF</Table.Th>
                    <Table.Th>Departamento</Table.Th>
                    <Table.Th>Centro de custo</Table.Th>
                    <Table.Th ta="right">Valor</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filtered.map((employee) => (
                    <Table.Tr key={employee.id}>
                      <Table.Td>
                        <Badge
                          color={statusColor[employee.status]}
                          variant="light"
                        >
                          {statusLabel[employee.status]}
                        </Badge>
                      </Table.Td>
                      <Table.Td fw={700}>{employee.name}</Table.Td>
                      <Table.Td>{employee.role || "-"}</Table.Td>
                      <Table.Td>{employee.registration || "-"}</Table.Td>
                      <Table.Td>{employee.cpf || "-"}</Table.Td>
                      <Table.Td>{employee.department || "-"}</Table.Td>
                      <Table.Td>
                        <Select
                          placeholder="Selecione"
                          data={config?.centers ?? []}
                          value={employee.costCenter}
                          onChange={(value) =>
                            updateEmployee(employee.id, {
                              costCenter: value,
                              status: value ? "LINKED" : employee.status,
                            })
                          }
                          searchable
                          w={220}
                        />
                      </Table.Td>
                      <Table.Td ta="right" fw={800}>
                        {money(employee.amount)}
                      </Table.Td>
                      <Table.Td>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => removeEmployee(employee.id)}
                        >
                          <IconTrash size={17} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" align="flex-end">
              <Stack gap="sm">
                <Checkbox
                  checked={saveLinks}
                  onChange={(event) =>
                    setSaveLinks(event.currentTarget.checked)
                  }
                  label="Salvar os vínculos de centro de custo para as próximas importações deste cliente"
                />
                <Group>
                  <Badge color="green" variant="light">
                    {totals.linked} vinculados
                  </Badge>
                  <Badge color="blue" variant="light">
                    {totals.newEmployees} novos
                  </Badge>
                  <Badge
                    color={totals.pending === 0 ? "green" : "orange"}
                    variant="light"
                  >
                    {totals.pending} pendências
                  </Badge>
                </Group>
              </Stack>

              <Button
                size="md"
                leftSection={<IconDownload size={18} />}
                disabled={!canExport}
              >
                Exportar planilha Conta Azul
              </Button>
            </Group>

            {!canExport && (
              <Alert
                mt="lg"
                color="orange"
                icon={<IconAlertTriangle size={18} />}
              >
                Valide o total, preencha as datas e informe o centro de custo
                de todos os colaboradores para liberar a exportação.
              </Alert>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}