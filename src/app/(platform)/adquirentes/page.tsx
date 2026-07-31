"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseRedeWorkbook, type ContractedRate } from "@/modules/acquirers/rede-workbook-parser";
import { exportAcquirerToContaAzul } from "@/modules/acquirers/conta-azul-exporter";
import { AcquirerAuditDashboard } from "@/modules/acquirers/components/acquirer-audit-dashboard";
import { trackImport } from "@/modules/imports/import-tracker";
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  FileButton,
  Group,
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
  IconBuildingBank,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconCreditCardPay,
  IconDownload,
  IconFileSpreadsheet,
  IconReceipt,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconTable,
  IconTrash,
  IconUpload,
  IconUser,
  IconX,
} from "@tabler/icons-react";

type EventType =
  | "SALE"
  | "FEE"
  | "ADJUSTMENT"
  | "CANCELLATION"
  | "CHARGEBACK"
  | "ANTICIPATION";

type ConvertedLine = {
  id: number;
  sourceSheet: string;
  sourceRow: number;
  eventType: EventType;
  saleDate: string;
  dueDate: string;
  paymentDate: string;
  description: string;
  category: string;
  amount: number;
  anticipated: boolean;
  status: "OK" | "REVIEW";
  rateValidation?: "MATCH" | "DIVERGENT" | "NOT_CONFIGURED" | "NOT_APPLICABLE";
  chargedRate?: number;
  contractedRate?: number;
  acquirer?: string;
  transactionType?: "DEBIT" | "CREDIT" | "PIX" | "VOUCHER" | "OTHER";
  cardBrand?: string;
  installments?: number;
};

type ClientOption = {
  value: string;
  label: string;
};

type ClientCategories = {
  sale: string;
  fee: string;
  adjustment: string;
  cancellation: string;
  chargeback: string;
  anticipation: string;
};

const exampleLines: ConvertedLine[] = [
  { id: 1, sourceSheet: "Recebimentos", sourceRow: 12, eventType: "SALE", saleDate: "2026-07-01", dueDate: "2026-07-03", paymentDate: "2026-07-03", description: "VENDA VISA CRÉDITO", category: "Receita de cartões", amount: 100, anticipated: false, status: "OK" },
  { id: 2, sourceSheet: "Recebimentos", sourceRow: 12, eventType: "FEE", saleDate: "2026-07-01", dueDate: "2026-07-03", paymentDate: "2026-07-03", description: "TAXA MDR VISA CRÉDITO", category: "Taxas de adquirentes", amount: -3.5, anticipated: false, status: "OK" },
  { id: 3, sourceSheet: "Recebimentos", sourceRow: 18, eventType: "SALE", saleDate: "2026-07-02", dueDate: "2026-07-05", paymentDate: "2026-07-05", description: "VENDA MASTERCARD DÉBITO", category: "Receita de cartões", amount: 350, anticipated: false, status: "OK" },
  { id: 4, sourceSheet: "Recebimentos", sourceRow: 18, eventType: "FEE", saleDate: "2026-07-02", dueDate: "2026-07-05", paymentDate: "2026-07-05", description: "TAXA MDR MASTERCARD DÉBITO", category: "Taxas de adquirentes", amount: -7.8, anticipated: false, status: "OK" },
  { id: 5, sourceSheet: "Ajustes", sourceRow: 7, eventType: "ADJUSTMENT", saleDate: "2026-07-04", dueDate: "2026-07-04", paymentDate: "2026-07-04", description: "AJUSTE FINANCEIRO POSITIVO", category: "Ajustes financeiros", amount: 35, anticipated: false, status: "OK" },
  { id: 6, sourceSheet: "Cancelamentos", sourceRow: 3, eventType: "CANCELLATION", saleDate: "2026-07-05", dueDate: "2026-07-05", paymentDate: "2026-07-05", description: "CANCELAMENTO VENDA ELO", category: "Cancelamentos de vendas", amount: -80, anticipated: false, status: "OK" },
  { id: 7, sourceSheet: "Antecipações", sourceRow: 9, eventType: "ANTICIPATION", saleDate: "2026-07-06", dueDate: "2026-07-06", paymentDate: "2026-07-06", description: "TAXA DE ANTECIPAÇÃO", category: "Taxa de antecipação", amount: -12, anticipated: true, status: "OK" },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function eventLabel(type: EventType) {
  return {
    SALE: "Venda bruta",
    FEE: "Taxa",
    ADJUSTMENT: "Ajuste",
    CANCELLATION: "Cancelamento",
    CHARGEBACK: "Chargeback",
    ANTICIPATION: "Antecipação",
  }[type];
}

function eventColor(type: EventType) {
  return {
    SALE: "green",
    FEE: "red",
    ADJUSTMENT: "blue",
    CANCELLATION: "orange",
    CHARGEBACK: "grape",
    ANTICIPATION: "yellow",
  }[type];
}

function transactionTypeLabel(type?: ConvertedLine["transactionType"]) {
  return {
    DEBIT: "Débito",
    CREDIT: "Crédito",
    PIX: "PIX",
    VOUCHER: "Voucher",
    OTHER: "Outro",
  }[type ?? "OTHER"];
}


type RateInfo = {
  chargedRate?: number;
  contractedRate?: number;
  validation: "MATCH" | "DIVERGENT" | "NOT_CONFIGURED" | "NOT_APPLICABLE";
  impact: number | null;
};

function getSaleRateInfo(line: ConvertedLine, allLines: ConvertedLine[]): RateInfo {
  if (line.eventType !== "SALE") {
    return { validation: "NOT_APPLICABLE", impact: null };
  }

  const relatedFee = allLines.find(
    (candidate) =>
      candidate.eventType === "FEE" &&
      candidate.sourceSheet === line.sourceSheet &&
      candidate.sourceRow === line.sourceRow,
  );

  const calculatedRate =
    line.amount > 0 && relatedFee
      ? (Math.abs(relatedFee.amount) / line.amount) * 100
      : undefined;

  const chargedRate = line.chargedRate ?? relatedFee?.chargedRate ?? calculatedRate;
  const contractedRate = line.contractedRate ?? relatedFee?.contractedRate;
  const validation =
    line.rateValidation ??
    relatedFee?.rateValidation ??
    (contractedRate == null ? "NOT_CONFIGURED" : "NOT_APPLICABLE");

  const impact =
    chargedRate != null && contractedRate != null
      ? line.amount * ((chargedRate - contractedRate) / 100)
      : null;

  return { chargedRate, contractedRate, validation, impact };
}

function formatRate(value?: number) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}%`;
}

function validationLabel(info: RateInfo) {
  if (info.validation === "MATCH") return "OK";
  if (info.validation === "DIVERGENT") return "Divergente";
  if (info.validation === "NOT_CONFIGURED") return "Sem taxa cadastrada";
  return "Não se aplica";
}

function validationColor(info: RateInfo) {
  if (info.validation === "MATCH") return "green";
  if (info.validation === "DIVERGENT") return "red";
  if (info.validation === "NOT_CONFIGURED") return "yellow";
  return "gray";
}

export default function AdquirentesPage() {
  const resetRef = useRef<() => void>(null);
  const [view, setView] = useState<"upload" | "review">("upload");
  const [processing, setProcessing] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ClientCategories | null>(null);
  const [contractedRates, setContractedRates] = useState<ContractedRate[]>([]);
  const [processedSheets, setProcessedSheets] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState(0);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [manualPaymentDate, setManualPaymentDate] = useState("2026-07-10");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<ConvertedLine[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const selectedClient = clients.find((client) => client.value === clientId);

  useEffect(() => {
    let cancelled = false;

    async function loadClients() {
      setClientsLoading(true);
      setClientsError(null);

      try {
        const response = await fetch("/api/clients?page=1&pageSize=100&status=active", {
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result?.error || "Não foi possível carregar os clientes.");
        }

        const options = Array.isArray(result?.data)
          ? result.data.map((client: { id: string; name: string }) => ({
              value: client.id,
              label: client.name,
            }))
          : [];

        if (!cancelled) {
          setClients(options);
        }
      } catch (error) {
        if (!cancelled) {
          setClients([]);
          setClientsError(
            error instanceof Error ? error.message : "Não foi possível carregar os clientes.",
          );
        }
      } finally {
        if (!cancelled) {
          setClientsLoading(false);
        }
      }
    }

    void loadClients();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadClientCategories() {
      if (!clientId) {
        setCategories(null);
        return;
      }

      setCategoriesLoading(true);
      setCategories(null);

      try {
        const response = await fetch(`/api/clients/${clientId}`, { cache: "no-store" });
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result?.error || "Não foi possível carregar o cliente.");
        }

        const mappings = Array.isArray(result?.client?.categoryMappings)
          ? result.client.categoryMappings
          : [];

        const categoryName = (mappingType: string, fallback: string) => {
          const mapping = mappings.find(
            (item: { mappingType?: string }) => item.mappingType === mappingType,
          );
          return mapping?.subcategory?.name || mapping?.category?.name || fallback;
        };

        if (!cancelled) {
          const acquirers = Array.isArray(result?.client?.acquirers) ? result.client.acquirers : [];
          setContractedRates(acquirers.flatMap((acquirer: { active?: boolean; rates?: ContractedRate[] }) => acquirer.active === false ? [] : (acquirer.rates ?? [])));
          setCategories({
            sale: categoryName("SALES_REVENUE", "Receita de cartões"),
            fee: categoryName("MDR_FEES", "Taxas de adquirentes"),
            adjustment: categoryName("MACHINE_RENTAL_ADJUSTMENTS", "Ajustes financeiros"),
            cancellation: categoryName("SALE_CANCELLATION", "Cancelamentos de vendas"),
            chargeback: categoryName("REFUNDS_CREDITS", "Chargeback"),
            anticipation: categoryName("ADVANCE_FEES", "Taxa de antecipação"),
          });
        }
      } catch {
        if (!cancelled) {
          setCategories(null);
          setContractedRates([]);
        }
      } finally {
        if (!cancelled) {
          setCategoriesLoading(false);
        }
      }
    }

    void loadClientCategories();

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const totals = useMemo(() => {
    const gross = lines
      .filter((line) => line.eventType === "SALE")
      .reduce((sum, line) => sum + line.amount, 0);
    const fees = lines
      .filter((line) => line.eventType === "FEE" || line.eventType === "ANTICIPATION")
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const adjustments = lines
      .filter((line) => line.eventType === "ADJUSTMENT")
      .reduce((sum, line) => sum + line.amount, 0);
    const cancellations = lines
      .filter((line) => line.eventType === "CANCELLATION" || line.eventType === "CHARGEBACK")
      .reduce((sum, line) => sum + Math.abs(line.amount), 0);
    const expectedNet = gross - fees + adjustments - cancellations;
    const identifiedNet = lines.reduce((sum, line) => sum + line.amount, 0);
    const difference = identifiedNet - expectedNet;

    const saleAudits = lines
      .filter((line) => line.eventType === "SALE")
      .map((line) => getSaleRateInfo(line, lines));

    const financialImpact = saleAudits.reduce(
      (sum, audit) => sum + (audit.impact ?? 0),
      0,
    );
    const overpaidImpact = saleAudits.reduce(
      (sum, audit) => sum + Math.max(audit.impact ?? 0, 0),
      0,
    );
    const divergentSales = saleAudits.filter(
      (audit) => audit.validation === "DIVERGENT",
    ).length;
    const matchedSales = saleAudits.filter(
      (audit) => audit.validation === "MATCH",
    ).length;
    const unconfiguredSales = saleAudits.filter(
      (audit) => audit.validation === "NOT_CONFIGURED",
    ).length;

    return {
      gross,
      fees,
      adjustments,
      cancellations,
      expectedNet,
      identifiedNet,
      difference,
      financialImpact,
      overpaidImpact,
      divergentSales,
      matchedSales,
      unconfiguredSales,
    };
  }, [lines]);

  const sourceSheets = processedSheets.length
    ? processedSheets
    : Array.from(new Set(lines.map((line) => line.sourceSheet)));

  const filteredLines = useMemo(() => {
    const term = search.trim().toLowerCase();
    return lines.filter((line) => {
      const rateInfo = getSaleRateInfo(line, lines);
      const matches =
        !term ||
        line.description.toLowerCase().includes(term) ||
        line.sourceSheet.toLowerCase().includes(term) ||
        line.category.toLowerCase().includes(term);
      const isProblem =
        line.status === "REVIEW" || rateInfo.validation === "DIVERGENT";
      return matches && (!onlyProblems || isProblem);
    });
  }, [lines, search, onlyProblems]);

  const groupedLines = useMemo(() => {
    const groups = filteredLines.reduce<
      Record<string, { date: string; lines: ConvertedLine[] }>
    >((accumulator, line) => {
      const key = line.paymentDate || line.dueDate || line.saleDate || "SEM_DATA";
      accumulator[key] ??= { date: key, lines: [] };
      accumulator[key].lines.push(line);
      return accumulator;
    }, {});

    return Object.values(groups).sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }, [filteredLines]);

  async function processFile() {
    if (!clientId || !file || !categories) return;
    setProcessing(true);
    try {
      const result = await parseRedeWorkbook(file, categories, manualPaymentDate, contractedRates);
      setLines(result.lines);
      setProcessedSheets(result.processedSheets);
      setSourceRows(result.sourceRows);
      setView("review");
    } catch (error) {
      console.error("Erro ao processar planilha:", error);
      window.alert(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    } finally {
      setProcessing(false);
    }
  }

  async function exportContaAzul() {
    try {
      exportAcquirerToContaAzul(lines, selectedClient?.label ?? "Cliente");
      await trackImport({
        clientId,
        module: "ACQUIRER",
        status: totals.divergentSales > 0 ? "REVIEW" : "EXPORTED",
        originalName: file?.name || "adquirente.xlsx",
        parserId: "rede-workbook",
        parserVersion: "1.0.0",
        expectedTotal: totals.expectedNet,
        parsedTotal: totals.identifiedNet,
        difference: totals.difference,
        metadata: {
          acquirer: "REDE",
          sourceRows,
          sheets: processedSheets,
          gross: totals.gross,
          fees: totals.fees,
          adjustments: totals.adjustments,
          cancellations: totals.cancellations,
          divergentSales: totals.divergentSales,
          exportFormat: "XLSX_CONTA_AZUL",
        },
        transactions: lines.map((line) => ({
          date: line.paymentDate || line.dueDate || line.saleDate || new Date().toISOString().slice(0, 10),
          description: line.description,
          amount: Math.abs(line.amount),
          type: line.amount >= 0 ? "CREDIT" : "DEBIT",
          category: line.category,
          metadata: { eventType: line.eventType, sourceSheet: line.sourceSheet },
        })),
      });
    } catch (error) {
      console.error("Erro ao exportar Conta Azul:", error);
      window.alert(error instanceof Error ? error.message : "Não foi possível exportar a planilha.");
    }
  }

  function resetPage() {
    setView("upload");
    setClientId(null);
    setFile(null);
    setManualPaymentDate("2026-07-10");
    setSearch("");
    setOnlyProblems(false);
    setLines([]);
    setProcessedSheets([]);
    setSourceRows(0);
    resetRef.current?.();
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Text size="xs" fw={800} c="blue" tt="uppercase">Importações</Text>
          <Title order={2}>Adquirentes</Title>
          <Text c="dimmed">Leia todas as abas da planilha e exporte venda bruta, taxas e demais eventos em linhas separadas no padrão Conta Azul.</Text>
        </Stack>
        {view === "review" && <Button variant="default" leftSection={<IconRefresh size={17} />} onClick={resetPage}>Nova importação</Button>}
      </Group>

      {view === "upload" ? (
        <Paper withBorder radius="xl" p={{ base: "lg", md: 38 }}>
          <Stack gap="xl">
            <Center>
              <Stack align="center" gap="sm" maw={760}>
                <ThemeIcon size={68} radius="xl" variant="light"><IconCreditCardPay size={34} /></ThemeIcon>
                <Title order={3} ta="center">Importe a planilha da adquirente</Title>
                <Text ta="center" c="dimmed">O sistema lê todas as abas e identifica vendas, taxas, ajustes, cancelamentos, chargebacks e antecipações.</Text>
              </Stack>
            </Center>

            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Select label="Cliente" description="As categorias serão carregadas do cadastro do cliente." placeholder={clientsLoading ? "Carregando clientes..." : "Selecione o cliente"} data={clients} value={clientId} onChange={setClientId} searchable clearable disabled={clientsLoading} nothingFoundMessage="Nenhum cliente encontrado" leftSection={<IconUser size={17} />} required />
              <TextInput label="Data de pagamento" description="Será aplicada inicialmente a todos os lançamentos." type="date" value={manualPaymentDate} onChange={(event) => setManualPaymentDate(event.currentTarget.value)} leftSection={<IconCalendar size={17} />} required />
            </SimpleGrid>

            {clientsError && (
              <Alert color="red" icon={<IconAlertTriangle size={18} />}>
                {clientsError}
              </Alert>
            )}

            {clientId && categoriesLoading && (
              <Text size="sm" c="dimmed">Carregando categorias do cliente...</Text>
            )}

            {categories && (
              <Paper withBorder radius="lg" p="lg">
                <Stack gap="md">
                  <Group><ThemeIcon variant="light" size={42} radius="md"><IconSettings size={22} /></ThemeIcon><Stack gap={1}><Text fw={800}>Categorias carregadas do cliente</Text><Text size="sm" c="dimmed">{selectedClient?.label}</Text></Stack></Group>
                  <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                    {[['Venda bruta', categories.sale], ['Taxas', categories.fee], ['Ajustes', categories.adjustment], ['Cancelamentos', categories.cancellation], ['Chargeback', categories.chargeback], ['Antecipação', categories.anticipation]].map(([label, value]) => <Card key={label} withBorder radius="md"><Text size="xs" c="dimmed">{label}</Text><Text fw={700}>{value}</Text></Card>)}
                  </SimpleGrid>
                </Stack>
              </Paper>
            )}

            <Paper withBorder radius="xl" p={38} style={{ borderStyle: "dashed" }}>
              <Stack align="center" gap="md">
                <ThemeIcon variant="light" size={54} radius="xl"><IconUpload size={27} /></ThemeIcon>
                <Text fw={800} fz="lg">Envie a planilha</Text>
                <Text size="sm" c="dimmed" ta="center">Todas as abas disponíveis serão processadas.</Text>
                <FileButton resetRef={resetRef} onChange={setFile} accept=".xlsx,.xls,.csv">{(props) => <Button {...props} size="md" leftSection={<IconUpload size={18} />}>Selecionar planilha</Button>}</FileButton>
                <Group gap="xs"><Badge variant="light">XLSX</Badge><Badge variant="light">XLS</Badge><Badge variant="light">CSV</Badge></Group>
              </Stack>
            </Paper>

            {file && <Card withBorder radius="lg"><Group justify="space-between"><Group><ThemeIcon variant="light" size={44} radius="md"><IconFileSpreadsheet size={23} /></ThemeIcon><Stack gap={1}><Text fw={700}>{file.name}</Text><Text size="sm" c="dimmed">{(file.size / 1024 / 1024).toFixed(2)} MB</Text></Stack></Group><ActionIcon variant="subtle" color="red" onClick={() => { setFile(null); resetRef.current?.(); }}><IconX size={18} /></ActionIcon></Group></Card>}

            <Alert color="blue" icon={<IconTable size={18} />}>Cada venda será exportada pelo valor bruto e cada taxa será exportada em uma linha negativa separada. O líquido será usado apenas para conferência.</Alert>

            <Group justify="flex-end"><Button size="md" disabled={!clientId || !file || !manualPaymentDate} loading={processing} onClick={processFile} rightSection={<IconChevronRight size={18} />}>Ler todas as abas</Button></Group>

            <Stack gap="sm"><Text fw={700}>Principais adquirentes previstas</Text><Group gap="xs">{["REDE", "Cielo", "Getnet", "Pagar.me", "Stone", "PagBank", "Mercado Pago", "SafraPay", "BIN", "Fiserv"].map((brand) => <Badge key={brand} variant="outline" color="gray">{brand}</Badge>)}</Group></Stack>
          </Stack>
        </Paper>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, xl: 5 }}>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Vendas brutas</Text>
              <Text fw={800} fz={20}>{formatMoney(totals.gross)}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Tarifas/Ajustes</Text>
              <Text fw={800} fz={20} c="red">-{formatMoney(totals.fees)}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Líquido esperado</Text>
              <Text fw={800} fz={20}>{formatMoney(totals.expectedNet)}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Líquido identificado</Text>
              <Text fw={800} fz={20} c="green">{formatMoney(totals.identifiedNet)}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Diferença</Text>
              <Text fw={800} fz={20} c={Math.abs(totals.difference) < 0.01 ? "green" : "red"}>
                {formatMoney(totals.difference)}
              </Text>
            </Card>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Taxas OK</Text>
              <Text fw={800} fz={24} c="green">{totals.matchedSales}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Vendas divergentes</Text>
              <Text fw={800} fz={24} c="red">{totals.divergentSales}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Sem taxa cadastrada</Text>
              <Text fw={800} fz={24}>{totals.unconfiguredSales}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Valor pago a mais</Text>
              <Text fw={800} fz={24} c={totals.overpaidImpact > 0 ? "red" : "green"}>
                {formatMoney(totals.overpaidImpact)}
              </Text>
              <Text size="xs" c="dimmed">
                Impacto líquido: {formatMoney(totals.financialImpact)}
              </Text>
            </Card>
          </SimpleGrid>

          <Paper withBorder radius="lg" p="lg">
            <Stack gap="xs">
              <Text fw={800}>Leitura completa REDE</Text>
              <Text size="sm" c="dimmed">
                {sourceSheets.length} aba(s) processada(s) • {sourceRows} linhas-fonte lidas
              </Text>
              <Text size="sm" c="dimmed">{sourceSheets.join(" • ")}</Text>
              <Alert color="green" icon={<IconCheck size={18} />}>
                A taxa cobrada é exibida na linha da venda. Quando houver taxa contratada no cliente,
                o sistema compara as duas e calcula o impacto financeiro. A linha negativa da tarifa
                permanece apenas para conciliação e exportação.
              </Alert>
            </Stack>
          </Paper>

          <AcquirerAuditDashboard lines={lines} />

          <Paper withBorder radius="lg">
            <Group justify="space-between" p="lg" align="flex-end">
              <Stack gap={3}>
                <Title order={4}>Recebimentos agrupados</Title>
                <Text size="sm" c="dimmed">
                  Abra uma data para conferir todos os lançamentos vinculados ao recebimento.
                </Text>
              </Stack>
              <Group>
                <Checkbox
                  checked={onlyProblems}
                  onChange={(event) => setOnlyProblems(event.currentTarget.checked)}
                  label="Somente divergências"
                />
                <TextInput
                  placeholder="Buscar descrição, origem ou categoria"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  leftSection={<IconSearch size={17} />}
                  w={320}
                />
              </Group>
            </Group>

            <Accordion variant="separated" radius="lg" px="md" pb="md">
              {groupedLines.map((group) => {
                const groupGross = group.lines
                  .filter((line) => line.eventType === "SALE")
                  .reduce((sum, line) => sum + line.amount, 0);
                const groupFees = group.lines
                  .filter((line) => line.eventType === "FEE" || line.eventType === "ANTICIPATION")
                  .reduce((sum, line) => sum + Math.abs(line.amount), 0);
                const groupNet = group.lines.reduce((sum, line) => sum + line.amount, 0);

                return (
                  <Accordion.Item key={group.date} value={group.date}>
                    <Accordion.Control>
                      <Group justify="space-between" wrap="nowrap" pr="md">
                        <Stack gap={1}>
                          <Text fw={800}>{group.date === "SEM_DATA" ? "Sem data" : formatDate(group.date)}</Text>
                          <Text size="xs" c="dimmed">
                            {group.lines.length} registro(s) • Bruto {formatMoney(groupGross)} • Tarifas {formatMoney(groupFees)}
                          </Text>
                        </Stack>
                        <Stack gap={0} align="flex-end">
                          <Text fw={800}>{formatMoney(groupNet)}</Text>
                          <Text size="xs" c="dimmed">Líquido recebido</Text>
                        </Stack>
                      </Group>
                    </Accordion.Control>
                    <Accordion.Panel>
                      <ScrollArea>
                        <Table miw={1900} verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Tipo</Table.Th>
                              <Table.Th>Origem</Table.Th>
                              <Table.Th>Competência</Table.Th>
                              <Table.Th>Vencimento</Table.Th>
                              <Table.Th>Pagamento</Table.Th>
                              <Table.Th>Adquirente</Table.Th>
                              <Table.Th>Modalidade</Table.Th>
                              <Table.Th>Bandeira</Table.Th>
                              <Table.Th>Parcelas</Table.Th>
                              <Table.Th>Descrição</Table.Th>
                              <Table.Th>Categoria</Table.Th>
                              <Table.Th ta="right">Valor</Table.Th>
                              <Table.Th>Taxa cobrada</Table.Th>
                              <Table.Th>Taxa cadastrada</Table.Th>
                              <Table.Th>Validação</Table.Th>
                              <Table.Th ta="right">Impacto financeiro</Table.Th>
                              <Table.Th />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {group.lines.map((line) => {
                              const rateInfo = getSaleRateInfo(line, lines);
                              const isSale = line.eventType === "SALE";

                              return (
                                <Table.Tr key={line.id}>
                                  <Table.Td>
                                    <Badge color={eventColor(line.eventType)} variant="light">
                                      {eventLabel(line.eventType)}
                                    </Badge>
                                  </Table.Td>
                                  <Table.Td>
                                    <Stack gap={0}>
                                      <Text fw={700}>{line.sourceSheet}</Text>
                                      <Text size="xs" c="dimmed">Linha {line.sourceRow}</Text>
                                    </Stack>
                                  </Table.Td>
                                  <Table.Td>{formatDate(line.saleDate)}</Table.Td>
                                  <Table.Td>{formatDate(line.dueDate)}</Table.Td>
                                  <Table.Td>
                                    <TextInput
                                      type="date"
                                      value={line.paymentDate}
                                      onChange={(event) =>
                                        setLines((current) =>
                                          current.map((item) =>
                                            item.id === line.id
                                              ? { ...item, paymentDate: event.currentTarget.value }
                                              : item,
                                          ),
                                        )
                                      }
                                      size="xs"
                                    />
                                  </Table.Td>
                                  <Table.Td>{line.acquirer ?? "—"}</Table.Td>
                                  <Table.Td>
                                    {line.eventType === "SALE" || line.eventType === "FEE"
                                      ? transactionTypeLabel(line.transactionType)
                                      : "—"}
                                  </Table.Td>
                                  <Table.Td>{line.cardBrand || (line.transactionType === "PIX" ? "Não se aplica" : "—")}</Table.Td>
                                  <Table.Td>
                                    {line.eventType === "SALE" || line.eventType === "FEE"
                                      ? line.transactionType === "CREDIT"
                                        ? `${line.installments ?? 1}x`
                                        : "1x"
                                      : "—"}
                                  </Table.Td>
                                  <Table.Td><Text fw={600}>{line.description}</Text></Table.Td>
                                  <Table.Td><Badge variant="outline" color="gray">{line.category}</Badge></Table.Td>
                                  <Table.Td ta="right" fw={800} c={line.amount >= 0 ? "green" : "red"}>
                                    {formatMoney(line.amount)}
                                  </Table.Td>
                                  <Table.Td>
                                    {isSale ? (
                                      <Text fw={700}>{formatRate(rateInfo.chargedRate)}</Text>
                                    ) : (
                                      <Text size="sm" c="dimmed">Não se aplica</Text>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    {isSale && rateInfo.contractedRate != null ? (
                                      <Text fw={700}>{formatRate(rateInfo.contractedRate)}</Text>
                                    ) : (
                                      <Text size="sm" c="dimmed">
                                        {isSale ? "Não cadastrada" : "Não se aplica"}
                                      </Text>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    <Badge color={validationColor(rateInfo)} variant="light">
                                      {validationLabel(rateInfo)}
                                    </Badge>
                                  </Table.Td>
                                  <Table.Td ta="right">
                                    {rateInfo.impact == null ? (
                                      <Text size="sm" c="dimmed">—</Text>
                                    ) : (
                                      <Stack gap={0} align="flex-end">
                                        <Text
                                          fw={800}
                                          c={rateInfo.impact > 0.005 ? "red" : rateInfo.impact < -0.005 ? "green" : undefined}
                                        >
                                          {formatMoney(rateInfo.impact)}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          {rateInfo.impact > 0.005
                                            ? "Pago a mais"
                                            : rateInfo.impact < -0.005
                                              ? "Pago a menos"
                                              : "Sem impacto"}
                                        </Text>
                                      </Stack>
                                    )}
                                  </Table.Td>
                                  <Table.Td>
                                    <ActionIcon
                                      variant="subtle"
                                      color="red"
                                      onClick={() =>
                                        setLines((current) => current.filter((item) => item.id !== line.id))
                                      }
                                    >
                                      <IconTrash size={17} />
                                    </ActionIcon>
                                  </Table.Td>
                                </Table.Tr>
                              );
                            })}
                          </Table.Tbody>
                        </Table>
                      </ScrollArea>
                    </Accordion.Panel>
                  </Accordion.Item>
                );
              })}
            </Accordion>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" align="flex-end">
              <SimpleGrid cols={{ base: 2, md: 4 }}>
                <Stack gap={0}><Text size="xs" c="dimmed">Linhas de saída</Text><Text fw={800} fz={20}>{lines.length}</Text></Stack>
                <Stack gap={0}><Text size="xs" c="dimmed">Venda bruta</Text><Text fw={800} fz={20} c="green">{formatMoney(totals.gross)}</Text></Stack>
                <Stack gap={0}><Text size="xs" c="dimmed">Total de taxas</Text><Text fw={800} fz={20} c="red">-{formatMoney(totals.fees)}</Text></Stack>
                <Stack gap={0}><Text size="xs" c="dimmed">Líquido conferido</Text><Text fw={800} fz={20}>{formatMoney(totals.expectedNet)}</Text></Stack>
              </SimpleGrid>
              <Button leftSection={<IconDownload size={18} />} size="md" disabled={lines.length === 0} onClick={exportContaAzul}>Exportar planilha Conta Azul</Button>
            </Group>
            <Alert mt="lg" color="green" icon={<IconReceipt size={18} />}>A exportação conterá venda bruta, taxa, ajustes, cancelamentos, chargebacks e antecipações em linhas independentes.</Alert>
          </Paper>
        </>
      )}
    </Stack>
  );
}