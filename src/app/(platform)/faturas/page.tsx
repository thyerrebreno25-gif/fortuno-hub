"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { notifications } from "@mantine/notifications";
import { parseCardInvoice } from "@/modules/card-invoices/parser";
import { CARD_INVOICE_IMAGE_ACCEPT } from "@/modules/card-invoices/image-reader.client";
import { exportInvoiceToContaAzul } from "@/modules/card-invoices/conta-azul-exporter";
import { trackImport } from "@/modules/imports/import-tracker";
import {
  areSimilarInvoiceMerchants,
  findLearnedInvoiceCategory,
  learnInvoiceCategory,
} from "@/modules/card-invoices/category-learning";
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
  PasswordInput,
  Modal,
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
  IconBrain,
  IconBuildingBank,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconCreditCard,
  IconDownload,
  IconEdit,
  IconFileInvoice,
  IconFileSpreadsheet,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTag,
  IconTrash,
  IconUpload,
  IconUser,
  IconX,
} from "@tabler/icons-react";

type InvoiceStatus = "LEARNED" | "NEW" | "REVIEW" | "CORRECTED";

type InvoiceItem = {
  id: number;
  date: string;
  description: string;
  amount: number;
  installment?: string;
  category: string | null;
  status: InvoiceStatus;
  learnedFromClient: boolean;
};

type ClientOption = { value: string; label: string };
type CategoryOption = { id: string; name: string; code?: string | null; children?: CategoryOption[] };


const exampleItems: InvoiceItem[] = [];

const ACTIVE_INVOICE_BANKS = [
  "Banco do Brasil",
  "Banco Inter",
  "Bradesco",
  "Itaú",
  "Santander",
  "Caixa",
  "BTG",
  "Sicredi",
  "Sicoob",
];
const PENDING_INVOICE_BANKS = [
  "Nubank",
  "C6",
  "XP",
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: string) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function statusLabel(status: InvoiceStatus) {
  if (status === "LEARNED") return "Aprendida";
  if (status === "NEW") return "Nova";
  if (status === "REVIEW") return "Revisar";
  return "Corrigida";
}

function statusColor(status: InvoiceStatus) {
  if (status === "LEARNED") return "green";
  if (status === "NEW") return "blue";
  if (status === "REVIEW") return "orange";
  return "teal";
}

export default function FaturasPage() {
  const resetRef = useRef<() => void>(null);

  const [view, setView] = useState<"upload" | "review">("upload");
  const [processing, setProcessing] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [bank, setBank] = useState<string | null>("Banco Inter");
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [competenceDate, setCompetenceDate] = useState("2026-07-01");
  const [dueDate, setDueDate] = useState("2026-07-15");
  const [paymentDate, setPaymentDate] = useState("2026-07-15");
  const [invoiceTotal, setInvoiceTotal] = useState<number | string>(0);

  const [items, setItems] = useState<InvoiceItem[]>(exampleItems);
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<InvoiceItem | null>(null);
  const [editModalOpened, setEditModalOpened] = useState(false);
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [learnForClient, setLearnForClient] = useState(true);
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryModalOpened, setCategoryModalOpened] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryCode, setNewCategoryCode] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  const selectedClient = clients.find((client) => client.value === clientId);

  useEffect(() => {
    let cancelled = false;
    async function loadClients() {
      setClientsLoading(true);
      try {
        const response = await fetch("/api/clients?page=1&pageSize=100&status=active", { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || "Não foi possível carregar os clientes.");
        const options = Array.isArray(result?.data)
          ? result.data.map((client: { id: string; name: string }) => ({ value: client.id, label: client.name }))
          : [];
        if (!cancelled) setClients(options);
      } catch (error) {
        if (!cancelled) notifications.show({ color: "red", title: "Clientes", message: error instanceof Error ? error.message : "Falha ao carregar clientes." });
      } finally {
        if (!cancelled) setClientsLoading(false);
      }
    }
    void loadClients();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!clientId) {
      setCategoryOptions([]);
      return;
    }

    const controller = new AbortController();

    async function loadCategories() {
      setCategoryLoading(true);
      try {
        const response = await fetch(`/api/clients/${clientId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          categories?: CategoryOption[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error || "Não foi possível carregar as categorias.");
        }

        const names = (result.categories ?? []).flatMap((category) => [
          category.name,
          ...(category.children ?? []).map(
            (child) => `${category.name} > ${child.name}`,
          ),
        ]);

        setCategoryOptions(
          Array.from(new Set(names)).sort((a, b) =>
            a.localeCompare(b, "pt-BR"),
          ),
        );
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          notifications.show({
            color: "red",
            title: "Categorias",
            message:
              error instanceof Error
                ? error.message
                : "Não foi possível carregar as categorias.",
          });
        }
      } finally {
        if (!controller.signal.aborted) setCategoryLoading(false);
      }
    }

    void loadCategories();
    return () => controller.abort();
  }, [clientId]);

  const diagnostics = useMemo(() => {
    const identifiedTotal = items.reduce((total, item) => total + item.amount, 0);
    const difference = identifiedTotal - Number(invoiceTotal || 0);
    const uncategorized = items.filter((item) => !item.category).length;
    const learned = items.filter((item) => item.learnedFromClient).length;
    const review = items.filter((item) => item.status === "REVIEW").length;

    let health = 100;
    health -= uncategorized * 8;
    health -= review * 5;
    if (Math.abs(difference) >= 0.01) health -= 25;

    return {
      identifiedTotal,
      difference,
      uncategorized,
      learned,
      review,
      validated: Math.abs(difference) < 0.01,
      health: Math.max(0, health),
    };
  }, [items, invoiceTotal]);

  const filteredItems = useMemo(() => {
    const normalized = search.trim().toLowerCase();

    if (!normalized) return items;

    return items.filter(
      (item) =>
        item.description.toLowerCase().includes(normalized) ||
        item.category?.toLowerCase().includes(normalized) ||
        item.date.includes(normalized),
    );
  }, [items, search]);

  async function processInvoice() {
    if (!clientId || !file || !bank) return;
    setProcessing(true);
    setParseWarnings([]);
    try {
      const parsed = await parseCardInvoice(file, bank, password);
      const exportableItems: InvoiceItem[] = parsed.items
        .filter((item) => item.exportable)
        .filter((item) => !/PAGAMENTO\s+ON\s*LINE|PAGAMENTO\s+ONLINE|PAGAMENTO\s+DA\s+FATURA|^PAGAMENTO\b/i.test(item.description.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))
        .map((item) => {
          const learnedRule = findLearnedInvoiceCategory(clientId, item.description);
          return {
            id: item.id,
            date: item.date,
            description: item.description,
            amount: item.amount,
            installment: item.installment,
            category: learnedRule?.category ?? null,
            status: learnedRule ? "LEARNED" : "NEW",
            learnedFromClient: Boolean(learnedRule),
          };
        });
      if (!exportableItems.length) throw new Error(parsed.warnings[0] || "Nenhum lançamento foi encontrado na fatura.");
      setItems(exportableItems);
      setParseWarnings(parsed.warnings);
      if (parsed.invoiceTotal !== null) setInvoiceTotal(parsed.invoiceTotal);
      if (parsed.dueDate) {
        setDueDate(parsed.dueDate);
        setPaymentDate(parsed.dueDate);
        setCompetenceDate(parsed.dueDate.slice(0, 7) + "-01");
      }
      setView("review");
      notifications.show({ color: "green", title: "Fatura lida", message: `${exportableItems.length} lançamentos reais identificados.` });
    } catch (error) {
      notifications.show({ color: "red", title: "Não foi possível ler a fatura", message: error instanceof Error ? error.message : "Erro desconhecido." });
    } finally {
      setProcessing(false);
    }
  }

  function resetPage() {
    setView("upload");
    setProcessing(false);
    setClientId(null);
    setBank("Banco Inter");
    setParseWarnings([]);
    setPassword("");
    setFile(null);
    setItems(exampleItems);
    setSelectedItem(null);
    setEditModalOpened(false);
    setSearch("");
    setApplyToSimilar(true);
    setLearnForClient(true);
    resetRef.current?.();
  }

  function removeItem(id: number) {
    setItems((current) => current.filter((item) => item.id !== id));

    if (selectedItem?.id === id) {
      setSelectedItem(null);
      setEditModalOpened(false);
    }
  }

  function closeEditModal() {
    setEditModalOpened(false);
    setSelectedItem(null);
  }

  function openEdit(item: InvoiceItem) {
    setSelectedItem({ ...item });
    setApplyToSimilar(true);
    setLearnForClient(true);
    setEditModalOpened(true);
  }

  async function createCategory() {
    const name = newCategoryName.trim();
    if (name.length < 2) return;

    setCreatingCategory(true);
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          code: newCategoryCode.trim() || null,
          parentId: null,
        }),
      });
      const result = (await response.json()) as {
        category?: CategoryOption;
        message?: string;
        error?: string;
      };
      if (!response.ok || !result.category) {
        throw new Error(result.error || "Não foi possível criar a categoria.");
      }

      const createdName = result.category.name;
      setCategoryOptions((current) =>
        Array.from(new Set([...current, createdName])).sort((a, b) =>
          a.localeCompare(b, "pt-BR"),
        ),
      );
      setSelectedItem((current) =>
        current ? { ...current, category: createdName } : current,
      );
      setNewCategoryName("");
      setNewCategoryCode("");
      setCategoryModalOpened(false);
      notifications.show({
        color: "green",
        title: "Categoria criada",
        message: `${createdName} já foi selecionada neste lançamento.`,
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Não foi possível criar",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível criar a categoria.",
      });
    } finally {
      setCreatingCategory(false);
    }
  }

  function saveItem() {
    if (!selectedItem) return;

    if (learnForClient && clientId && selectedItem.category) {
      learnInvoiceCategory({
        clientId,
        description: selectedItem.description,
        category: selectedItem.category,
      });
    }

    setItems((current) =>
      current.map((item) => {
        const sameMerchant = areSimilarInvoiceMerchants(
          item.description,
          selectedItem.description,
        );

        if (item.id === selectedItem.id || (applyToSimilar && sameMerchant)) {
          return {
            ...item,
            category: selectedItem.category,
            status: "CORRECTED",
            learnedFromClient: learnForClient,
          };
        }

        return item;
      }),
    );

    closeEditModal();
  }

  async function exportContaAzul() {
    if (!clientId || !file || !bank || !canExport) return;
    const clientName = clients.find((item) => item.value === clientId)?.label || "Cliente";
    try {
      exportInvoiceToContaAzul({
        items,
        clientName,
        bankName: bank,
        competenceDate,
        dueDate,
        paymentDate,
      });

      const normalizedInvoiceTotal =
  typeof invoiceTotal === "number"
    ? invoiceTotal
    : invoiceTotal.trim()
      ? Number(invoiceTotal.replace(/\./g, "").replace(",", "."))
      : null;

      await trackImport({
        clientId,
        module: "CREDIT_CARD_INVOICE",
        status: "EXPORTED",
        originalName: file.name,
        parserId: bank.toLowerCase().includes("inter") ? "inter-invoice" : "card-invoice",
        parserVersion: "1.0.0",
        expectedTotal:
  normalizedInvoiceTotal !== null &&
  Number.isFinite(normalizedInvoiceTotal)
    ? normalizedInvoiceTotal
    : diagnostics.identifiedTotal,
        parsedTotal: diagnostics.identifiedTotal,
        difference: diagnostics.difference,
        metadata: {
          bank,
          dueDate,
          competenceDate,
          paymentDate,
          itemCount: items.length,
          categorized: items.length - diagnostics.uncategorized,
          warnings: parseWarnings,
          exportFormat: "XLSX_CONTA_AZUL",
        },
        transactions: items.map((item) => ({
          date: item.date,
          description: item.description,
          amount: item.amount,
          type: item.amount < 0 ? "CREDIT" : "DEBIT",
          category: item.category,
          metadata: { installment: item.installment || null },
        })),
      });
      notifications.show({ color: "green", title: "Exportação concluída", message: "Planilha gerada e processamento salvo no histórico." });
    } catch (error) {
      notifications.show({ color: "red", title: "Não foi possível exportar", message: error instanceof Error ? error.message : "Erro desconhecido." });
    }
  }

  const canExport =
    diagnostics.validated && diagnostics.uncategorized === 0 && diagnostics.review === 0;

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Text size="xs" fw={800} c="blue" tt="uppercase">
            Importações
          </Text>

          <Title order={2}>Faturas de cartão</Title>

          <Text c="dimmed">
            Importe a fatura em PDF ou imagem, revise os lançamentos e exporte no padrão
            do Conta Azul com categorização aprendida por cliente.
          </Text>
        </Stack>

        {view === "review" && (
          <Button
            variant="default"
            leftSection={<IconRefresh size={17} />}
            onClick={resetPage}
          >
            Nova fatura
          </Button>
        )}
      </Group>

      {view === "upload" ? (
        <Paper withBorder radius="xl" p={{ base: "lg", md: 38 }}>
          <Stack gap="xl">
            <Center>
              <Stack align="center" gap="sm" maw={700}>
                <ThemeIcon size={68} radius="xl" variant="light">
                  <IconFileInvoice size={34} />
                </ThemeIcon>

                <Title order={3} ta="center">
                  Importe uma fatura de cartão
                </Title>

                <Text ta="center" c="dimmed">
                  O Fortuno Hub usa o banco selecionado, lê os lançamentos reais, confere
                  o total da fatura e aplica as categorias já aprendidas para
                  o cliente selecionado.
                </Text>
              </Stack>
            </Center>

            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <Select
                label="Cliente"
                description="O aprendizado de categorias será exclusivo deste cliente."
                placeholder="Selecione o cliente"
                data={clients}
                value={clientId}
                disabled={clientsLoading}
                onChange={setClientId}
                searchable
                clearable
                leftSection={<IconUser size={17} />}
                required
              />

              <Select
                label="Banco da fatura"
                description="Somente bancos com leitor ativo podem ser selecionados."
                placeholder="Selecione o banco"
                data={ACTIVE_INVOICE_BANKS}
                value={bank}
                onChange={setBank}
                searchable
                required
                leftSection={<IconBuildingBank size={17} />}
              />

              <PasswordInput
                label="Senha do PDF"
                description="Preencha somente para um PDF protegido; imagens não usam senha."
                placeholder="Senha opcional"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                leftSection={<IconLock size={17} />}
              />
            </SimpleGrid>

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

                <Stack align="center" gap={4}>
                  <Text fw={800} fz="lg">
                    Envie a fatura em PDF ou imagem
                  </Text>

                  <Text size="sm" c="dimmed" ta="center">
                    Aceita PDF, PNG, JPG, JPEG e WebP. PDFs protegidos por senha
                    também poderão ser processados.
                  </Text>
                </Stack>

                <FileButton
                  resetRef={resetRef}
                  onChange={setFile}
                  accept={`.pdf,application/pdf,${CARD_INVOICE_IMAGE_ACCEPT}`}
                >
                  {(props) => (
                    <Button
                      {...props}
                      leftSection={<IconUpload size={18} />}
                      size="md"
                    >
                      Selecionar arquivo
                    </Button>
                  )}
                </FileButton>

                <Text size="sm" c="dimmed">
                  Arraste o arquivo para esta área ou clique para selecionar.
                </Text>
              </Stack>
            </Paper>

            {file && (
              <Card withBorder radius="lg">
                <Group justify="space-between">
                  <Group>
                    <ThemeIcon variant="light" size={44} radius="md">
                      <IconFileInvoice size={23} />
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
                    aria-label="Remover arquivo"
                  >
                    <IconX size={18} />
                  </ActionIcon>
                </Group>
              </Card>
            )}

            <Alert color="blue" variant="light" icon={<IconBrain size={18} />}>
              Na primeira importação, as categorias ainda não reconhecidas
              serão preenchidas manualmente. Depois de salvas, serão sugeridas
              automaticamente nas próximas faturas do mesmo cliente.
            </Alert>

            <Group justify="flex-end">
              <Button
                size="md"
                disabled={!clientId || !file || !bank}
                loading={processing}
                onClick={processInvoice}
                rightSection={<IconChevronRight size={18} />}
              >
                Ler e diagnosticar fatura
              </Button>
            </Group>

            <Stack gap="sm">
              <Text fw={700}>Cobertura dos leitores de fatura</Text>

              <Stack gap={6}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  Já aprendidos
                </Text>

                <Group gap="xs">
                  {ACTIVE_INVOICE_BANKS.map((bank) => (
                    <Badge key={bank} variant="light" color="green">
                      {bank} ativo
                    </Badge>
                  ))}
                </Group>
              </Stack>

              <Stack gap={6}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  Ainda não aprendidos
                </Text>

                <Group gap="xs">
                  {PENDING_INVOICE_BANKS.map((bank) => (
                    <Badge key={bank} variant="outline" color="gray">
                      {bank} em preparação
                    </Badge>
                  ))}
                </Group>
              </Stack>
            </Stack>
          </Stack>
        </Paper>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
            <Paper withBorder radius="lg" p="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">
                    Cliente
                  </Text>
                  <Text fw={800} fz={20}>
                    {selectedClient?.label ?? "Cliente selecionado"}
                  </Text>
                  <Badge variant="light" color="blue">
                    Aprendizado isolado
                  </Badge>
                </Stack>

                <ThemeIcon variant="light" size={44} radius="md">
                  <IconUser size={23} />
                </ThemeIcon>
              </Group>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">
                    Banco identificado
                  </Text>
                  <Text fw={800} fz={20}>
                    {bank ?? "Banco não informado"}
                  </Text>
                  <Badge color="green" variant="light">
                    Seleção manual
                  </Badge>
                </Stack>

                <ThemeIcon variant="light" size={44} radius="md">
                  <IconBuildingBank size={23} />
                </ThemeIcon>
              </Group>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Group justify="space-between" align="flex-start">
                <Stack gap={4}>
                  <Text size="sm" c="dimmed">
                    Cartão identificado
                  </Text>
                  <Text fw={800} fz={20}>
                    Conforme PDF importado
                  </Text>
                  <Text size="sm" c="dimmed">
                    Identificação automática por bloco
                  </Text>
                </Stack>

                <ThemeIcon variant="light" size={44} radius="md">
                  <IconCreditCard size={23} />
                </ThemeIcon>
              </Group>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Stack gap={6}>
                <Group justify="space-between">
                  <Stack gap={1}>
                    <Text size="sm" c="dimmed">
                      Saúde da leitura
                    </Text>
                    <Text fw={800} fz={25}>
                      {diagnostics.health}%
                    </Text>
                  </Stack>

                  <Badge
                    color={
                      diagnostics.health >= 90
                        ? "green"
                        : diagnostics.health >= 70
                          ? "orange"
                          : "red"
                    }
                    variant="light"
                  >
                    {diagnostics.health >= 90
                      ? "Excelente"
                      : diagnostics.health >= 70
                        ? "Revisar"
                        : "Crítica"}
                  </Badge>
                </Group>

                <Progress
                  value={diagnostics.health}
                  color={
                    diagnostics.health >= 90
                      ? "green"
                      : diagnostics.health >= 70
                        ? "orange"
                        : "red"
                  }
                  radius="xl"
                  size="md"
                />
              </Stack>
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, xl: 2 }}>
            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Group justify="space-between">
                  <Stack gap={2}>
                    <Title order={4}>Dados da fatura</Title>
                    <Text size="sm" c="dimmed">
                      Campos que serão replicados na planilha do Conta Azul.
                    </Text>
                  </Stack>

                  <Badge variant="light" color="blue">
                    Padrão Conta Azul
                  </Badge>
                </Group>

                <SimpleGrid cols={{ base: 1, sm: 3 }}>
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
                    label="Vencimento da fatura"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.currentTarget.value)}
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

                <SimpleGrid cols={{ base: 1, sm: 3 }}>
                  <NumberInput
                    label="Valor final da fatura"
                    value={invoiceTotal}
                    onChange={setInvoiceTotal}
                    prefix="R$ "
                    decimalScale={2}
                    fixedDecimalScale
                    thousandSeparator="."
                    decimalSeparator=","
                  />

                  <Card withBorder radius="md">
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Total identificado
                      </Text>
                      <Text fw={800} fz={20}>
                        {formatMoney(diagnostics.identifiedTotal)}
                      </Text>
                    </Stack>
                  </Card>

                  <Card withBorder radius="md">
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Diferença
                      </Text>
                      <Text
                        fw={800}
                        fz={20}
                        c={diagnostics.validated ? "green" : "orange"}
                      >
                        {formatMoney(diagnostics.difference)}
                      </Text>
                    </Stack>
                  </Card>
                </SimpleGrid>

                <Alert
                  color={diagnostics.validated ? "green" : "orange"}
                  icon={
                    diagnostics.validated ? (
                      <IconCheck size={18} />
                    ) : (
                      <IconAlertTriangle size={18} />
                    )
                  }
                >
                  {diagnostics.validated
                    ? "O total dos lançamentos confere com o valor final da fatura."
                    : "Existe diferença entre o total identificado e o valor final informado."}
                </Alert>
              </Stack>
            </Paper>

            <Paper withBorder radius="lg" p="lg">
              <Stack gap="lg">
                <Group>
                  <ThemeIcon variant="light" size={44} radius="md">
                    <IconBrain size={23} />
                  </ThemeIcon>

                  <Stack gap={2}>
                    <Title order={4}>Diagnóstico inteligente</Title>
                    <Text size="sm" c="dimmed">
                      Resultado da leitura e do aprendizado do cliente.
                    </Text>
                  </Stack>
                </Group>

                <Text>
                  Foram encontrados <strong>{items.length} lançamentos</strong>.
                  O Fortuno Hub reconheceu automaticamente{" "}
                  <strong>{diagnostics.learned} categorias</strong> a partir do
                  histórico de <strong>{selectedClient?.label}</strong>. Ainda
                  existem <strong>{diagnostics.uncategorized} lançamentos sem
                  categoria</strong> e <strong>{diagnostics.review} lançamento
                  para revisão</strong>.
                </Text>

                <SimpleGrid cols={{ base: 2, sm: 3 }}>
                  <Card withBorder radius="md">
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Aprendidas
                      </Text>
                      <Text fw={800} fz={24} c="green">
                        {diagnostics.learned}
                      </Text>
                    </Stack>
                  </Card>

                  <Card withBorder radius="md">
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Sem categoria
                      </Text>
                      <Text fw={800} fz={24} c="blue">
                        {diagnostics.uncategorized}
                      </Text>
                    </Stack>
                  </Card>

                  <Card withBorder radius="md">
                    <Stack gap={0}>
                      <Text size="xs" c="dimmed">
                        Para revisão
                      </Text>
                      <Text fw={800} fz={24} c="orange">
                        {diagnostics.review}
                      </Text>
                    </Stack>
                  </Card>
                </SimpleGrid>

                <Alert color="blue" icon={<IconTag size={18} />}>
                  Ao salvar uma categoria, o sistema poderá aplicá-la a todas
                  as ocorrências iguais desta fatura e aprender a regra para
                  as próximas faturas deste cliente.
                </Alert>
              </Stack>
            </Paper>
          </SimpleGrid>

          {parseWarnings.length > 0 && (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              {parseWarnings.join(" ")}
            </Alert>
          )}

          <Paper withBorder radius="lg">
            <Group justify="space-between" p="lg" align="flex-end">
              <Stack gap={3}>
                <Title order={4}>Lançamentos da fatura</Title>
                <Text size="sm" c="dimmed">
                  Revise as descrições e categorize os itens ainda não
                  reconhecidos.
                </Text>
              </Stack>

              <TextInput
                placeholder="Buscar descrição ou categoria"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                leftSection={<IconSearch size={17} />}
                w={{ base: "100%", sm: 320 }}
              />
            </Group>

            <ScrollArea>
              <Table
                miw={1050}
                verticalSpacing="sm"
                horizontalSpacing="md"
                highlightOnHover
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Data</Table.Th>
                    <Table.Th>Descrição</Table.Th>
                    <Table.Th>Parcela</Table.Th>
                    <Table.Th>Categoria</Table.Th>
                    <Table.Th ta="right">Valor</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>

                <Table.Tbody>
                  {filteredItems.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <Badge
                          color={statusColor(item.status)}
                          variant="light"
                        >
                          {statusLabel(item.status)}
                        </Badge>
                      </Table.Td>

                      <Table.Td>{formatDate(item.date)}</Table.Td>

                      <Table.Td>
                        <Stack gap={1}>
                          <Text fw={600}>{item.description}</Text>

                          {item.learnedFromClient && (
                            <Text size="xs" c="green">
                              Categoria aprendida para este cliente
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>

                      <Table.Td>{item.installment ?? "-"}</Table.Td>

                      <Table.Td>
                        {item.category ? (
                          <Badge variant="outline" color="gray">
                            {item.category}
                          </Badge>
                        ) : (
                          <Text size="sm" c="orange" fw={700}>
                            Não definida
                          </Text>
                        )}
                      </Table.Td>

                      <Table.Td ta="right" fw={700}>
                        {formatMoney(item.amount)}
                      </Table.Td>

                      <Table.Td>
                        <Group gap={4} justify="flex-end">
                          <ActionIcon
                            variant="subtle"
                            onClick={() => openEdit(item)}
                            aria-label="Editar lançamento"
                          >
                            <IconEdit size={17} />
                          </ActionIcon>

                          <ActionIcon
                            variant="subtle"
                            color="red"
                            onClick={() => removeItem(item.id)}
                            aria-label="Excluir lançamento"
                          >
                            <IconTrash size={17} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>

          <Modal
            opened={editModalOpened}
            onClose={closeEditModal}
            title="Categorizar lançamento"
            centered
            size="lg"
            closeOnClickOutside={!categoryModalOpened}
            closeOnEscape={!categoryModalOpened}
          >
            {selectedItem && (
              <Stack gap="lg">
                <Paper
                  radius="md"
                  p="md"
                  bg="var(--mantine-color-gray-0)"
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={3} style={{ minWidth: 0 }}>
                      <Text fw={800} lineClamp={2}>
                        {selectedItem.description}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {formatDate(selectedItem.date)}
                        {selectedItem.installment
                          ? ` · Parcela ${selectedItem.installment}`
                          : ""}
                      </Text>
                    </Stack>

                    <Text fw={800} fz="lg" style={{ whiteSpace: "nowrap" }}>
                      {formatMoney(selectedItem.amount)}
                    </Text>
                  </Group>
                </Paper>

                <Stack gap={6}>
                  <Select
                    label="Categoria"
                    description={`A regra será exclusiva de ${
                      selectedClient?.label ?? "este cliente"
                    }.`}
                    placeholder={
                      categoryLoading
                        ? "Carregando categorias..."
                        : "Buscar ou selecionar categoria"
                    }
                    data={categoryOptions}
                    searchable
                    clearable
                    disabled={categoryLoading}
                    value={selectedItem.category}
                    onChange={(value) =>
                      setSelectedItem((current) =>
                        current ? { ...current, category: value } : current,
                      )
                    }
                    leftSection={<IconTag size={17} />}
                    nothingFoundMessage="Nenhuma categoria encontrada"
                    required
                    comboboxProps={{ withinPortal: true }}
                  />

                  <Button
                    variant="subtle"
                    size="compact-sm"
                    leftSection={<IconPlus size={15} />}
                    onClick={() => setCategoryModalOpened(true)}
                    style={{ alignSelf: "flex-start" }}
                  >
                    Criar nova categoria
                  </Button>
                </Stack>

                <Stack gap="sm">
                  <Checkbox
                    checked={applyToSimilar}
                    onChange={(event) =>
                      setApplyToSimilar(event.currentTarget.checked)
                    }
                    label="Aplicar esta categoria às ocorrências semelhantes desta fatura"
                  />

                  <Checkbox
                    checked={learnForClient}
                    onChange={(event) =>
                      setLearnForClient(event.currentTarget.checked)
                    }
                    label={`Aprender esta categoria para as próximas faturas de ${
                      selectedClient?.label ?? "este cliente"
                    }`}
                  />
                </Stack>

                <Group justify="flex-end">
                  <Button variant="default" onClick={closeEditModal}>
                    Cancelar
                  </Button>

                  <Button
                    disabled={!selectedItem.category}
                    leftSection={<IconCheck size={17} />}
                    onClick={saveItem}
                  >
                    {learnForClient ? "Salvar e aprender" : "Salvar categoria"}
                  </Button>
                </Group>
              </Stack>
            )}
          </Modal>

          <Modal
            opened={categoryModalOpened}
            onClose={() => {
              if (!creatingCategory) {
                setCategoryModalOpened(false);
                setNewCategoryName("");
                setNewCategoryCode("");
              }
            }}
            title="Criar categoria"
            centered
          >
            <Stack>
              <Text size="sm" c="dimmed">
                A nova categoria será cadastrada na base da organização e ficará
                disponível também nas próximas faturas.
              </Text>
              <TextInput
                label="Nome da categoria"
                placeholder="Ex.: Treinamentos e cursos"
                value={newCategoryName}
                onChange={(event) =>
                  setNewCategoryName(event.currentTarget.value)
                }
                required
                autoFocus
              />
              <TextInput
                label="Código (opcional)"
                placeholder="Ex.: 3.02.04"
                value={newCategoryCode}
                onChange={(event) =>
                  setNewCategoryCode(event.currentTarget.value)
                }
              />
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={creatingCategory}
                  onClick={() => setCategoryModalOpened(false)}
                >
                  Cancelar
                </Button>
                <Button
                  loading={creatingCategory}
                  disabled={newCategoryName.trim().length < 2}
                  leftSection={<IconPlus size={16} />}
                  onClick={() => void createCategory()}
                >
                  Criar e selecionar
                </Button>
              </Group>
            </Stack>
          </Modal>

          <Paper withBorder radius="lg" p="lg">
            <Group justify="space-between" align="flex-end">
              <SimpleGrid cols={{ base: 2, md: 4 }}>
                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    Lançamentos
                  </Text>
                  <Text fw={800} fz={20}>
                    {items.length}
                  </Text>
                </Stack>

                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    Total identificado
                  </Text>
                  <Text fw={800} fz={20}>
                    {formatMoney(diagnostics.identifiedTotal)}
                  </Text>
                </Stack>

                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    Categorizados
                  </Text>
                  <Text fw={800} fz={20} c="green">
                    {items.length - diagnostics.uncategorized}
                  </Text>
                </Stack>

                <Stack gap={0}>
                  <Text size="xs" c="dimmed">
                    Pendências
                  </Text>
                  <Text
                    fw={800}
                    fz={20}
                    c={
                      diagnostics.uncategorized + diagnostics.review === 0
                        ? "green"
                        : "orange"
                    }
                  >
                    {diagnostics.uncategorized + diagnostics.review}
                  </Text>
                </Stack>
              </SimpleGrid>

              <Button
                leftSection={<IconFileSpreadsheet size={18} />}
                disabled={!canExport}
                onClick={exportContaAzul}
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
                Para liberar a exportação, categorize todos os lançamentos,
                revise as pendências e valide o total da fatura.
              </Alert>
            )}
          </Paper>
        </>
      )}
    </Stack>
  );
}
