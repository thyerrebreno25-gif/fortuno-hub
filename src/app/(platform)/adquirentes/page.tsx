"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ContractedRate,
  type FeeCategory,
  type ReadingInstructionSummary,
} from "@/modules/acquirers/rede-workbook-parser";
import {
  parseAcquirerWorkbook,
  type ConfiguredAcquirerRates,
  type SupportedAcquirer,
} from "@/modules/acquirers/parse-acquirer-workbook";
import type { CieloSourceTotals } from "@/modules/acquirers/cielo-workbook-parser";
import { interpretReadingInstructions } from "@/modules/acquirers/reading-instructions";
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
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
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
  IconSparkles,
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
  feeCategory?: FeeCategory;
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


function feeCategoryLabel(type?: FeeCategory) {
  return {
    SALE_FEE: "Taxas de venda (MDR)",
    ANTICIPATION: "Antecipações",
    EQUIPMENT: "Maquininhas e equipamentos",
    ADJUSTMENT: "Ajustes financeiros",
    CHARGEBACK: "Chargebacks",
    CANCELLATION: "Cancelamentos",
    OTHER: "Outras tarifas",
  }[type ?? "OTHER"];
}

function feeCategoryColor(type?: FeeCategory) {
  return {
    SALE_FEE: "red",
    ANTICIPATION: "yellow",
    EQUIPMENT: "blue",
    ADJUSTMENT: "cyan",
    CHARGEBACK: "grape",
    CANCELLATION: "orange",
    OTHER: "gray",
  }[type ?? "OTHER"];
}

const feeCategoryOrder: FeeCategory[] = [
  "SALE_FEE",
  "ANTICIPATION",
  "EQUIPMENT",
  "ADJUSTMENT",
  "CHARGEBACK",
  "CANCELLATION",
  "OTHER",
];

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
  const [configuredAcquirers, setConfiguredAcquirers] = useState<ConfiguredAcquirerRates[]>([]);
  const [processedSheets, setProcessedSheets] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState(0);
  const [detectedAcquirer, setDetectedAcquirer] = useState<SupportedAcquirer | null>(null);
  const [activeParser, setActiveParser] = useState({ id: "", version: "" });
  const [sourceTotals, setSourceTotals] = useState<CieloSourceTotals | null>(null);
  const [readingInstructions, setReadingInstructions] = useState("");
  const [instructionSummary, setInstructionSummary] = useState<ReadingInstructionSummary | null>(null);
  const [instructionReviewConfirmed, setInstructionReviewConfirmed] = useState(false);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [manualPaymentDate, setManualPaymentDate] = useState("2026-07-10");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<ConvertedLine[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const selectedClient = clients.find((client) => client.value === clientId);
  const interpretedInstructions = useMemo(
    () => interpretReadingInstructions(readingInstructions),
    [readingInstructions],
  );
  const unmatchedInstructionRules = instructionSummary?.rules.filter((rule) =>
    instructionSummary.unmatchedRuleIds.includes(rule.id),
  ) ?? [];

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
          setConfiguredAcquirers(
            acquirers.flatMap((acquirer: {
              active?: boolean;
              name?: string;
              rates?: ContractedRate[];
            }) => acquirer.active === false || !acquirer.name
              ? []
              : [{ name: acquirer.name, rates: acquirer.rates ?? [] }]),
          );
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
          setConfiguredAcquirers([]);
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

    const costLines = lines.filter(
      (line) => line.eventType !== "SALE" && line.amount < 0,
    );

    const feeBreakdown = feeCategoryOrder.map((feeCategory) => {
      const categoryLines = costLines.filter(
        (line) => (line.feeCategory ?? "OTHER") === feeCategory,
      );

      return {
        feeCategory,
        label: feeCategoryLabel(feeCategory),
        amount: categoryLines.reduce(
          (sum, line) => sum + Math.abs(line.amount),
          0,
        ),
        count: categoryLines.length,
        lines: categoryLines,
      };
    });

    const totalCosts = feeBreakdown.reduce(
      (sum, category) => sum + category.amount,
      0,
    );

    const saleFees = feeBreakdown.find(
      (category) => category.feeCategory === "SALE_FEE",
    )?.amount ?? 0;
    const anticipationFees = feeBreakdown.find(
      (category) => category.feeCategory === "ANTICIPATION",
    )?.amount ?? 0;
    const equipmentFees = feeBreakdown.find(
      (category) => category.feeCategory === "EQUIPMENT",
    )?.amount ?? 0;

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
      feeBreakdown,
      totalCosts,
      saleFees,
      anticipationFees,
      equipmentFees,
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
    setProcessingError(null);
    if (interpretedInstructions.unrecognized.length > 0) {
      setProcessingError(
        "Há uma orientação que o leitor ainda não conseguiu transformar em regra. Ajuste o texto indicado antes de continuar.",
      );
      return;
    }
    setProcessing(true);
    try {
      const result = await parseAcquirerWorkbook(
        file,
        categories,
        manualPaymentDate,
        configuredAcquirers,
        { readingRules: interpretedInstructions.rules },
      );
      setLines(result.lines);
      setProcessedSheets(result.processedSheets);
      setSourceRows(result.sourceRows);
      setDetectedAcquirer(result.acquirer);
      setActiveParser({ id: result.parserId, version: result.parserVersion });
      setSourceTotals(result.sourceTotals);
      setInstructionSummary(result.instructionSummary);
      setInstructionReviewConfirmed(false);
      setView("review");
    } catch (error) {
      console.error("Erro ao processar planilha:", error);
      setProcessingError(
        error instanceof Error ? error.message : "Não foi possível ler a planilha.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function exportContaAzul() {
    try {
      exportAcquirerToContaAzul(
        lines,
        selectedClient?.label ?? "Cliente",
        detectedAcquirer ?? "ADQUIRENTE",
      );
      await trackImport({
        clientId,
        module: "ACQUIRER",
        status: totals.divergentSales > 0 ? "REVIEW" : "EXPORTED",
        originalName: file?.name || "adquirente.xlsx",
        parserId: activeParser.id || null,
        parserVersion: activeParser.version || null,
        expectedTotal: totals.expectedNet,
        parsedTotal: totals.identifiedNet,
        difference: totals.difference,
        metadata: {
          acquirer: detectedAcquirer,
          sourceRows,
          sheets: processedSheets,
          gross: totals.gross,
          fees: totals.fees,
          totalCosts: totals.totalCosts,
          saleFees: totals.saleFees,
          anticipationFees: totals.anticipationFees,
          equipmentFees: totals.equipmentFees,
          feeBreakdown: totals.feeBreakdown.map((item) => ({
            feeCategory: item.feeCategory,
            amount: item.amount,
            count: item.count,
          })),
          adjustments: totals.adjustments,
          cancellations: totals.cancellations,
          divergentSales: totals.divergentSales,
          exportFormat: "XLSX_CONTA_AZUL",
          readingInstructions: readingInstructions.trim() || null,
          readingRules: instructionSummary?.rules.map((rule) => ({
            action: rule.action,
            field: rule.field,
            value: rule.value,
          })) ?? [],
          excludedSourceRows: instructionSummary?.excludedRows ?? 0,
          sourceTotals,
        },
        transactions: lines.map((line) => ({
          date: line.paymentDate || line.dueDate || line.saleDate || new Date().toISOString().slice(0, 10),
          description: line.description,
          amount: Math.abs(line.amount),
          type: line.amount >= 0 ? "CREDIT" : "DEBIT",
          category: line.category,
          metadata: {
            eventType: line.eventType,
            feeCategory: line.feeCategory ?? null,
            sourceSheet: line.sourceSheet,
          },
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
    setDetectedAcquirer(null);
    setActiveParser({ id: "", version: "" });
    setSourceTotals(null);
    setReadingInstructions("");
    setInstructionSummary(null);
    setInstructionReviewConfirmed(false);
    setProcessingError(null);
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

            <Paper withBorder radius="lg" p="lg">
              <Stack gap="md">
                <Group align="flex-start" wrap="nowrap">
                  <ThemeIcon variant="light" size={42} radius="md">
                    <IconSparkles size={22} />
                  </ThemeIcon>
                  <Stack gap={2}>
                    <Text fw={800}>Orientações ao leitor</Text>
                    <Text size="sm" c="dimmed">
                      Escreva o que deve ser incluído ou ignorado. Use uma orientação por linha para o sistema confirmar exatamente o que entendeu.
                    </Text>
                  </Stack>
                </Group>

                <Textarea
                  label="Instruções para esta importação (opcional)"
                  placeholder={'Ex.: Não quero os dados da conta 12345-6\nIgnorar bandeira Elo\nTrazer apenas modalidade débito'}
                  description="O leitor entende conta, estabelecimento, bandeira, modalidade, aba e descrição."
                  value={readingInstructions}
                  onChange={(event) => {
                    setReadingInstructions(event.currentTarget.value);
                    setProcessingError(null);
                  }}
                  autosize
                  minRows={3}
                  maxRows={8}
                />

                {interpretedInstructions.rules.length > 0 && (
                  <Stack gap="xs">
                    <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                      O leitor entendeu
                    </Text>
                    <Group gap="xs">
                      {interpretedInstructions.rules.map((rule) => (
                        <Badge key={rule.id} variant="light" color={rule.action === "EXCLUDE" ? "orange" : "blue"}>
                          {rule.label}
                        </Badge>
                      ))}
                    </Group>
                  </Stack>
                )}

                {interpretedInstructions.unrecognized.length > 0 && (
                  <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Orientação ainda não compreendida">
                    {interpretedInstructions.unrecognized.map((instruction) => (
                      <Text key={instruction} size="sm">“{instruction}”</Text>
                    ))}
                    <Text size="sm" mt={4}>
                      Informe a ação e o campo. Exemplo: “Ignorar estabelecimento Loja Centro”.
                    </Text>
                  </Alert>
                )}
              </Stack>
            </Paper>

            <Paper withBorder radius="xl" p={38} style={{ borderStyle: "dashed" }}>
              <Stack align="center" gap="md">
                <ThemeIcon variant="light" size={54} radius="xl"><IconUpload size={27} /></ThemeIcon>
                <Text fw={800} fz="lg">Envie a planilha</Text>
                <Text size="sm" c="dimmed" ta="center">Todas as abas disponíveis serão processadas.</Text>
                <FileButton resetRef={resetRef} onChange={setFile} accept=".xlsx,.xls,.csv">{(props) => <Button {...props} size="md" leftSection={<IconUpload size={18} />}>Selecionar planilha</Button>}</FileButton>
                <Group gap="xs"><Badge variant="light">XLSX</Badge><Badge variant="light">XLS</Badge><Badge variant="light">CSV</Badge></Group>
              </Stack>
            </Paper>

            {file && <Card withBorder radius="lg"><Group justify="space-between"><Group><ThemeIcon variant="light" size={44} radius="md"><IconFileSpreadsheet size={23} /></ThemeIcon><Stack gap={1}><Text fw={700}>{file.name}</Text><Text size="sm" c="dimmed">{(file.size / 1024 / 1024).toFixed(2)} MB</Text></Stack></Group><ActionIcon variant="subtle" color="red" onClick={() => { setFile(null); setProcessingError(null); resetRef.current?.(); }}><IconX size={18} /></ActionIcon></Group></Card>}

            {processingError && (
              <Alert color="red" icon={<IconAlertTriangle size={18} />}>
                {processingError}
              </Alert>
            )}

            <Alert color="blue" icon={<IconTable size={18} />}>Cada venda será exportada pelo valor bruto e cada taxa será exportada em uma linha negativa separada. O líquido será usado apenas para conferência.</Alert>

            <Group justify="flex-end"><Button size="md" disabled={!clientId || !file || !manualPaymentDate || interpretedInstructions.unrecognized.length > 0} loading={processing} onClick={processFile} rightSection={<IconChevronRight size={18} />}>Ler todas as abas</Button></Group>

            <Stack gap="sm">
              <Text fw={700}>Leitores disponíveis</Text>
              <Group gap="xs">
                {["REDE", "Cielo"].map((brand) => (
                  <Badge key={brand} variant="light" color="green">{brand} ativo</Badge>
                ))}
                {["Getnet", "Pagar.me", "Stone", "PagBank", "Mercado Pago", "SafraPay", "BIN", "Fiserv"].map((brand) => (
                  <Badge key={brand} variant="outline" color="gray">{brand} em preparação</Badge>
                ))}
              </Group>
            </Stack>
          </Stack>
        </Paper>
      ) : (
        <>
          {instructionSummary && instructionSummary.rules.length > 0 && (
            <Alert
              color={unmatchedInstructionRules.length > 0 ? "yellow" : "teal"}
              icon={unmatchedInstructionRules.length > 0 ? <IconAlertTriangle size={19} /> : <IconSparkles size={19} />}
              title="Resultado das orientações ao leitor"
            >
              <Stack gap="sm">
                <Text size="sm">
                  {instructionSummary.excludedRows} linha(s) da planilha foram retiradas antes da criação dos lançamentos.
                </Text>
                <Stack gap={4}>
                  {instructionSummary.rules.map((rule) => {
                    const matches = instructionSummary.matchesByRule[rule.id] ?? 0;
                    const exclusions = instructionSummary.exclusionsByRule[rule.id] ?? 0;
                    return (
                      <Group key={rule.id} gap="xs">
                        <Badge variant="light" color={matches > 0 ? "teal" : "yellow"}>
                          {matches > 0 ? `${matches} ocorrência(s)` : "nenhuma ocorrência"}
                        </Badge>
                        <Text size="sm">
                          {rule.label}{exclusions > 0 ? ` — ${exclusions} linha(s) retirada(s)` : ""}
                        </Text>
                      </Group>
                    );
                  })}
                </Stack>
                {unmatchedInstructionRules.length > 0 && (
                  <Checkbox
                    checked={instructionReviewConfirmed}
                    onChange={(event) => setInstructionReviewConfirmed(event.currentTarget.checked)}
                    label="Revisei as orientações sem ocorrência e desejo permitir a exportação mesmo assim."
                  />
                )}
              </Stack>
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, sm: 2, xl: 5 }}>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Vendas brutas</Text>
              <Text fw={800} fz={20}>{formatMoney(totals.gross)}</Text>
            </Card>
            <Card withBorder radius="lg">
              <Text size="xs" c="dimmed">Custos e descontos</Text>
              <Text fw={800} fz={20} c="red">-{formatMoney(totals.totalCosts)}</Text>
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
            <Stack gap="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={2}>
                  <Title order={4}>Composição dos custos e descontos</Title>
                  <Text size="sm" c="dimmed">
                    Separe taxas de venda, antecipações, equipamentos e demais
                    descontos para entender onde está o custo da operação.
                  </Text>
                </Stack>
                <Stack gap={0} align="flex-end">
                  <Text size="xs" c="dimmed">TOTAL IDENTIFICADO</Text>
                  <Text fw={800} fz={24} c="red">
                    -{formatMoney(totals.totalCosts)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {totals.gross > 0
                      ? `${((totals.totalCosts / totals.gross) * 100).toLocaleString(
                          "pt-BR",
                          {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          },
                        )}% das vendas brutas`
                      : "Sem vendas brutas para comparação"}
                  </Text>
                </Stack>
              </Group>

              <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
                {totals.feeBreakdown
                  .filter((item) => item.amount > 0)
                  .map((item) => (
                    <Card key={item.feeCategory} withBorder radius="lg">
                      <Stack gap={5}>
                        <Group justify="space-between" wrap="nowrap">
                          <Badge
                            color={feeCategoryColor(item.feeCategory)}
                            variant="light"
                          >
                            {item.label}
                          </Badge>
                          <Text size="xs" c="dimmed">
                            {item.count} item(ns)
                          </Text>
                        </Group>
                        <Text fw={800} fz={22}>
                          {formatMoney(item.amount)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {totals.totalCosts > 0
                            ? `${((item.amount / totals.totalCosts) * 100).toLocaleString(
                                "pt-BR",
                                {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                },
                              )}% do total de custos`
                            : "0% do total"}
                        </Text>
                        <Progress
                          value={
                            totals.totalCosts > 0
                              ? (item.amount / totals.totalCosts) * 100
                              : 0
                          }
                          color={feeCategoryColor(item.feeCategory)}
                          radius="xl"
                        />
                      </Stack>
                    </Card>
                  ))}
              </SimpleGrid>

              {totals.feeBreakdown.some((item) => item.amount > 0) ? (
                <Accordion variant="separated" radius="md">
                  {totals.feeBreakdown
                    .filter((item) => item.amount > 0)
                    .map((item) => (
                      <Accordion.Item
                        key={item.feeCategory}
                        value={`fee-${item.feeCategory}`}
                      >
                        <Accordion.Control>
                          <Group justify="space-between" pr="md">
                            <Group gap="sm">
                              <Badge
                                color={feeCategoryColor(item.feeCategory)}
                                variant="light"
                              >
                                {item.label}
                              </Badge>
                              <Text size="sm" c="dimmed">
                                {item.count} lançamento(s)
                              </Text>
                            </Group>
                            <Text fw={800}>{formatMoney(item.amount)}</Text>
                          </Group>
                        </Accordion.Control>
                        <Accordion.Panel>
                          <ScrollArea>
                            <Table
                              miw={760}
                              verticalSpacing="sm"
                              horizontalSpacing="md"
                            >
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Data</Table.Th>
                                  <Table.Th>Descrição original</Table.Th>
                                  <Table.Th>Origem</Table.Th>
                                  <Table.Th>Categoria Conta Azul</Table.Th>
                                  <Table.Th ta="right">Valor</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {item.lines.map((line) => (
                                  <Table.Tr key={`cost-${line.id}`}>
                                    <Table.Td>
                                      {formatDate(
                                        line.paymentDate ||
                                          line.dueDate ||
                                          line.saleDate,
                                      )}
                                    </Table.Td>
                                    <Table.Td>
                                      <Text fw={600}>{line.description}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Stack gap={0}>
                                        <Text size="sm">{line.sourceSheet}</Text>
                                        <Text size="xs" c="dimmed">
                                          Linha {line.sourceRow}
                                        </Text>
                                      </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                      <Badge variant="outline" color="gray">
                                        {line.category}
                                      </Badge>
                                    </Table.Td>
                                    <Table.Td ta="right" fw={800} c="red">
                                      -{formatMoney(Math.abs(line.amount))}
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                        </Accordion.Panel>
                      </Accordion.Item>
                    ))}
                </Accordion>
              ) : (
                <Alert color="blue" icon={<IconReceipt size={18} />}>
                  Nenhum custo ou desconto negativo foi identificado nesta
                  importação.
                </Alert>
              )}
            </Stack>
          </Paper>

          <Paper withBorder radius="lg" p="lg">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={800}>Leitura completa {detectedAcquirer ?? "da adquirente"}</Text>
                {detectedAcquirer && <Badge variant="light">{detectedAcquirer}</Badge>}
              </Group>
              <Text size="sm" c="dimmed">
                {sourceSheets.length} aba(s) processada(s) • {sourceRows} linhas-fonte lidas
              </Text>
              <Text size="sm" c="dimmed">{sourceSheets.join(" • ")}</Text>
              {sourceTotals && sourceTotals.net != null && (
                <Card withBorder radius="md" mt="xs">
                  <SimpleGrid cols={{ base: 2, md: 4 }}>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">Linhas no totalizador</Text>
                      <Text fw={800}>{sourceTotals.rows ?? "—"}</Text>
                    </Stack>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">Bruto do arquivo</Text>
                      <Text fw={800}>{formatMoney(sourceTotals.gross ?? 0)}</Text>
                    </Stack>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">Taxas do arquivo</Text>
                      <Text fw={800} c="red">-{formatMoney(sourceTotals.fees ?? 0)}</Text>
                    </Stack>
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">Líquido do arquivo</Text>
                      <Text fw={800} c="green">{formatMoney(sourceTotals.net)}</Text>
                    </Stack>
                  </SimpleGrid>
                </Card>
              )}
              {sourceTotals && sourceTotals.net != null && (
                instructionSummary?.excludedRows ? (
                  <Alert color="blue" icon={<IconTable size={18} />}>
                    O totalizador original foi preservado como referência. Como existem linhas
                    excluídas por orientação, a conciliação abaixo considera apenas os registros mantidos.
                  </Alert>
                ) : (
                  <Alert
                    color={Math.abs(totals.identifiedNet - sourceTotals.net) < 0.01 ? "green" : "red"}
                    icon={Math.abs(totals.identifiedNet - sourceTotals.net) < 0.01 ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
                  >
                    {Math.abs(totals.identifiedNet - sourceTotals.net) < 0.01
                      ? "O valor líquido calculado confere com o totalizador do arquivo."
                      : `Há uma diferença de ${formatMoney(totals.identifiedNet - sourceTotals.net)} entre a leitura e o totalizador.`}
                  </Alert>
                )
              )}
              <Alert color="green" icon={<IconCheck size={18} />}>
                A taxa cobrada é exibida na linha da venda. Quando houver taxa contratada no cliente,
                o sistema compara as duas e calcula o impacto financeiro. A linha negativa da tarifa
                permanece apenas para conciliação e exportação.
              </Alert>
            </Stack>
          </Paper>

          <AcquirerAuditDashboard lines={lines} acquirer={detectedAcquirer ?? "Adquirente"} />

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
                        <Table miw={2100} verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
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
                <Stack gap={0}><Text size="xs" c="dimmed">Custos e descontos</Text><Text fw={800} fz={20} c="red">-{formatMoney(totals.totalCosts)}</Text></Stack>
                <Stack gap={0}><Text size="xs" c="dimmed">Líquido conferido</Text><Text fw={800} fz={20}>{formatMoney(totals.expectedNet)}</Text></Stack>
              </SimpleGrid>
              <Button
                leftSection={<IconDownload size={18} />}
                size="md"
                disabled={
                  lines.length === 0
                  || (unmatchedInstructionRules.length > 0 && !instructionReviewConfirmed)
                }
                onClick={exportContaAzul}
              >
                Exportar planilha Conta Azul
              </Button>
            </Group>
            <Alert mt="lg" color="green" icon={<IconReceipt size={18} />}>A exportação conterá venda bruta, taxa, ajustes, cancelamentos, chargebacks e antecipações em linhas independentes.</Alert>
          </Paper>
        </>
      )}
    </Stack>
  );
}
