"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Loader,
  Pagination,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconDownload,
  IconFileSpreadsheet,
  IconRefresh,
  IconSearch,
  IconUpload,
} from "@tabler/icons-react";
import type {
  SalesDestinationRule,
  SalesReconciliationResult,
  SalesReconciliationRow,
  SalesReconciliationStatus,
  SalesWorkbookPreview,
} from "@/modules/sales-reconciliation/types";
import styles from "./sales-reconciliation.module.css";

type Client = {
  id: string;
  name: string;
  document?: string | null;
  contaAzulConnection?: { active: boolean; status: string } | null;
};

type CategoryOption = { value: string; label: string };

type Mapping = {
  clientId: string;
  expectedCategoryName: string;
  productCategories: Record<string, string>;
};

const STATUS_META: Record<SalesReconciliationStatus, { label: string; color: string }> = {
  OK: { label: "Conferido", color: "green" },
  WRONG_CATEGORY: { label: "Categoria incorreta", color: "orange" },
  NOT_FOUND: { label: "Não encontrado", color: "red" },
  NEARBY_DATE: { label: "Data próxima", color: "yellow" },
  AMBIGUOUS: { label: "Duplicidade", color: "violet" },
  UNMAPPED_DESTINATION: { label: "Cadastro não vinculado", color: "gray" },
  NEGATIVE_REVIEW: { label: "Estorno/ajuste", color: "blue" },
};

const STORAGE_KEY = "fortuno.sales-reconciliation.settings.v1";

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function latestMonthRange(end: string) {
  return { start: `${end.slice(0, 7)}-01`, end };
}

function readSavedMappings() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, Mapping>;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export default function SalesReconciliationPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [canSupervise, setCanSupervise] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [preview, setPreview] = useState<SalesWorkbookPreview | null>(null);
  const [mappings, setMappings] = useState<Record<string, Mapping>>({});
  const [categories, setCategories] = useState<Record<string, CategoryOption[]>>({});
  const [categoryLoading, setCategoryLoading] = useState<Record<string, boolean>>({});
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [reading, setReading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<SalesReconciliationResult | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch("/api/audit/bootstrap", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Não foi possível carregar os clientes.");
        setClients(Array.isArray(body.clients) ? body.clients : []);
        setCanSupervise(Boolean(body.currentUser?.canSupervise));
      })
      .catch((error) => notifications.show({
        color: "red",
        title: "Conferência de vendas",
        message: error instanceof Error ? error.message : "Falha ao carregar a tela.",
      }))
      .finally(() => setBootstrapLoading(false));
  }, []);

  useEffect(() => {
    if (!preview) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
  }, [mappings, preview]);

  useEffect(() => {
    const ids = Array.from(new Set(Object.values(mappings).map((item) => item.clientId).filter(Boolean)));
    ids.forEach((clientId) => {
      if (categories[clientId] || categoryLoading[clientId]) return;
      setCategoryLoading((current) => ({ ...current, [clientId]: true }));
      fetch(`/api/sales-reconciliation/options?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Não foi possível carregar as categorias.");
          setCategories((current) => ({ ...current, [clientId]: body.categories ?? [] }));
        })
        .catch((error) => notifications.show({
          color: "red",
          title: "Categorias do Conta Azul",
          message: error instanceof Error ? error.message : "Falha ao consultar categorias.",
        }))
        .finally(() => setCategoryLoading((current) => ({ ...current, [clientId]: false })));
    });
  }, [mappings, categories, categoryLoading]);

  const connectedClients = useMemo(
    () => clients.filter((client) => client.contaAzulConnection?.active && client.contaAzulConnection.status === "CONNECTED"),
    [clients],
  );
  const clientOptions = connectedClients.map((client) => ({
    value: client.id,
    label: `${client.name}${client.document ? ` · ${client.document}` : ""}`,
  }));

  const periodEntries = useMemo(() => preview?.entries.filter((entry) => (
    Boolean(periodStart && periodEnd) && entry.paymentDate >= periodStart && entry.paymentDate <= periodEnd
  )) ?? [], [preview, periodStart, periodEnd]);

  const activeProducts = useMemo(() => {
    const values: Record<string, string[]> = {};
    periodEntries.forEach((entry) => {
      const destination = entry.destinationLabel || "Sem cadastro informado";
      const product = entry.product || "Sem produto informado";
      values[destination] ??= [];
      if (!values[destination].includes(product)) values[destination].push(product);
    });
    Object.values(values).forEach((products) => products.sort((a, b) => a.localeCompare(b, "pt-BR")));
    return values;
  }, [periodEntries]);

  const filteredRows = useMemo(() => {
    if (!result) return [];
    const term = normalized(search);
    return result.rows.filter((row) => (
      (statusFilter === "ALL" || !statusFilter || row.status === statusFilter)
      && (!term || normalized([
        row.customer,
        row.receiptName,
        row.product,
        row.destinationLabel,
        row.contaAzul?.description,
        row.contaAzul?.counterparty,
      ].join(" ")).includes(term))
    ));
  }, [result, search, statusFilter]);

  const pageSize = 50;
  const pagedRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  async function handleFile(file: File | null) {
    if (!file) return;
    setReading(true);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/sales-reconciliation/preview", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível ler a planilha.");
      const next = body as SalesWorkbookPreview;
      setPreview(next);
      if (next.dateRange) {
        const range = latestMonthRange(next.dateRange.end);
        setPeriodStart(range.start);
        setPeriodEnd(range.end);
      }
      const saved = readSavedMappings();
      const nextMappings: Record<string, Mapping> = {};
      next.destinations.forEach((destination) => {
        const persisted = saved[destination];
        const persistedClient = connectedClients.some((client) => client.id === persisted?.clientId) ? persisted.clientId : "";
        const words = normalized(destination).split(" ").filter((word) => word.length >= 4);
        const automatic = connectedClients.find((client) => words.some((word) => normalized(client.name).includes(word)));
        nextMappings[destination] = {
          clientId: persistedClient || automatic?.id || "",
          expectedCategoryName: persisted?.expectedCategoryName || "",
          productCategories: persisted?.productCategories || {},
        };
      });
      setMappings(nextMappings);
      notifications.show({
        color: "green",
        title: "Planilha lida",
        message: `${next.validRows} vendas válidas encontradas. O período foi posicionado no mês mais recente.`,
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Planilha não lida",
        message: error instanceof Error ? error.message : "Não foi possível ler o arquivo.",
      });
    } finally {
      setReading(false);
    }
  }

  function updateMapping(destination: string, patch: Partial<Mapping>) {
    setMappings((current) => ({
      ...current,
      [destination]: {
        ...(current[destination] ?? { clientId: "", expectedCategoryName: "", productCategories: {} }),
        ...patch,
      },
    }));
  }

  async function compare() {
    if (!preview || !periodStart || !periodEnd) return;
    const activeDestinations = new Set(periodEntries.map((entry) => entry.destinationLabel || "Sem cadastro informado"));
    if ([...activeDestinations].some((destination) => !mappings[destination]?.clientId)) {
      notifications.show({ color: "orange", title: "Vínculo pendente", message: "Vincule todos os cadastros encontrados a um cliente conectado." });
      return;
    }
    setComparing(true);
    setResult(null);
    try {
      const rules: SalesDestinationRule[] = Object.entries(mappings)
        .filter(([sourceLabel]) => activeDestinations.has(sourceLabel))
        .map(([sourceLabel, mapping]) => ({
          sourceLabel,
          clientId: mapping.clientId,
          expectedCategoryName: mapping.expectedCategoryName || null,
          productCategories: mapping.productCategories,
        }));
      const response = await fetch("/api/sales-reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd, entries: preview.entries, rules }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível concluir a conferência.");
      setResult(body as SalesReconciliationResult);
      setPage(1);
      notifications.show({
        color: "green",
        title: "Conferência concluída",
        message: `${body.summary.ok} de ${body.summary.spreadsheetRows} vendas foram conferidas sem divergência.`,
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Conferência não concluída",
        message: error instanceof Error ? error.message : "Falha ao consultar o Conta Azul.",
      });
    } finally {
      setComparing(false);
    }
  }

  function exportReport() {
    if (!result) return;
    const rows = result.rows.filter((row) => row.status !== "OK").map((row) => ({
      Status: STATUS_META[row.status].label,
      Detalhe: row.statusDetail,
      "Linha na planilha": row.sourceRow,
      "Data de pagamento": date(row.paymentDate),
      Cliente: row.customer,
      Produto: row.product,
      "Cadastro de destino": row.destinationLabel,
      Valor: row.amount,
      "Categoria esperada": row.expectedCategory || "",
      "Descrição no Conta Azul": row.contaAzul?.description || "",
      "Contato no Conta Azul": row.contaAzul?.counterparty || "",
      "Categoria no Conta Azul": row.contaAzul?.categoryNames.join(" / ") || "",
      "Valor no Conta Azul": row.contaAzul?.amount ?? "",
      "Competência no Conta Azul": date(row.contaAzul?.competenceDate),
      "Vencimento no Conta Azul": date(row.contaAzul?.dueDate),
      "Pagamento no Conta Azul": date(row.contaAzul?.paymentDate),
    }));
    const extras = result.extraContaAzul.map((item) => ({
      Cliente: item.clientName,
      Descrição: item.description,
      Contato: item.counterparty,
      Categorias: item.categoryNames.join(" / "),
      Valor: item.amount,
      Competência: date(item.competenceDate),
      Vencimento: date(item.dueDate),
      Pagamento: date(item.paymentDate),
      Status: item.status,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Divergências");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(extras), "Somente no Conta Azul");
    XLSX.writeFile(workbook, `conferencia_vendas_${periodStart}_${periodEnd}.xlsx`);
  }

  if (bootstrapLoading) {
    return <div className={styles.loading}><Loader /><Text>Carregando conferência de vendas...</Text></div>;
  }

  return (
    <main className={styles.page}>
      <Group justify="space-between" align="flex-start" className={styles.header}>
        <div>
          <Text className={styles.eyebrow}>AUDITORIA DE RECEITAS</Text>
          <Title order={1}>Conferência de vendas</Title>
          <Text c="dimmed">Compare a planilha do cliente com os lançamentos existentes no Conta Azul.</Text>
        </div>
        {result && <Button leftSection={<IconDownload size={17} />} onClick={exportReport}>Baixar divergências</Button>}
      </Group>

      {!canSupervise && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />} mb="lg">
          Esta conferência só pode ser iniciada por gestores e líderes de equipe.
        </Alert>
      )}

      <Paper withBorder radius="lg" p="lg" mb="lg">
        <Stack gap="lg">
          <Group justify="space-between" align="flex-end" wrap="wrap">
            <div>
              <Text fw={800}>1. Planilha e período</Text>
              <Text size="sm" c="dimmed">O filtro sempre usa a coluna DATA PG, incluindo as duas datas informadas.</Text>
            </div>
            <FileButton onChange={handleFile} accept=".xlsx,.xls">
              {(props) => (
                <Button {...props} disabled={!canSupervise || reading} loading={reading} leftSection={<IconUpload size={17} />}>
                  {preview ? "Substituir planilha" : "Selecionar planilha"}
                </Button>
              )}
            </FileButton>
          </Group>

          {preview ? (
            <>
              <Alert color="blue" icon={<IconFileSpreadsheet size={19} />}>
                <Text fw={700}>{preview.fileName}</Text>
                <Text size="sm">
                  {preview.validRows} linhas válidas · aba {preview.sheetName} · {preview.ignoredCash} em dinheiro ignorada(s) · {preview.missingPaymentDate} sem DATA PG · {preview.invalidAmount} com valor inválido
                </Text>
              </Alert>
              <Group grow align="flex-end" className={styles.periodFields}>
                <label>
                  <Text size="sm" fw={600} mb={5}>Data inicial</Text>
                  <input className={styles.dateInput} type="date" value={periodStart} onChange={(event) => setPeriodStart(event.currentTarget.value)} />
                </label>
                <label>
                  <Text size="sm" fw={600} mb={5}>Data final</Text>
                  <input className={styles.dateInput} type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.currentTarget.value)} />
                </label>
                <Paper withBorder radius="md" p="sm">
                  <Text size="xs" c="dimmed">Vendas no período</Text>
                  <Text fw={800} fz={20}>{periodEntries.length}</Text>
                </Paper>
                <Paper withBorder radius="md" p="sm">
                  <Text size="xs" c="dimmed">Valor da planilha</Text>
                  <Text fw={800} fz={20}>{money(periodEntries.reduce((sum, entry) => sum + entry.amount, 0))}</Text>
                </Paper>
              </Group>
            </>
          ) : (
            <div className={styles.emptyUpload}>
              <IconFileSpreadsheet size={34} />
              <Text fw={700}>Envie a planilha ENCOMENDAS</Text>
              <Text size="sm" c="dimmed">A leitura percorre todas as linhas, mesmo quando o Excel estiver com filtro ativo.</Text>
            </div>
          )}
        </Stack>
      </Paper>

      {preview && (
        <Paper withBorder radius="lg" p="lg" mb="lg">
          <Stack gap="md">
            <div>
              <Text fw={800}>2. Vincule os cadastros e categorias</Text>
              <Text size="sm" c="dimmed">Cada nome da coluna CNPJ BISTRÔ OU DOCE aponta para seu próprio cadastro conectado no Conta Azul.</Text>
            </div>
            <SimpleGrid cols={{ base: 1, xl: 2 }} spacing="md">
              {Object.keys(activeProducts).map((destination) => {
                const mapping = mappings[destination] ?? { clientId: "", expectedCategoryName: "", productCategories: {} };
                const categoryOptions = categories[mapping.clientId] ?? [];
                const products = activeProducts[destination] ?? [];
                return (
                  <Paper key={destination} withBorder radius="md" p="md">
                    <Stack gap="sm">
                      <Group justify="space-between">
                        <div>
                          <Text fw={800}>{destination}</Text>
                          <Text size="xs" c="dimmed">{periodEntries.filter((entry) => (entry.destinationLabel || "Sem cadastro informado") === destination).length} venda(s) no período</Text>
                        </div>
                        {mapping.clientId && <Badge color="green" variant="light">Conta Azul conectado</Badge>}
                      </Group>
                      <Select
                        label="Cadastro de destino"
                        placeholder="Selecione o cliente"
                        searchable
                        data={clientOptions}
                        value={mapping.clientId || null}
                        onChange={(value) => updateMapping(destination, {
                          clientId: value || "",
                          expectedCategoryName: "",
                          productCategories: {},
                        })}
                        nothingFoundMessage="Nenhum cliente conectado"
                      />
                      <Select
                        label="Categoria de receita esperada"
                        description="Obrigatória para que uma venda seja considerada totalmente conferida."
                        placeholder={mapping.clientId ? "Selecione a categoria esperada" : "Selecione primeiro o cadastro"}
                        searchable
                        clearable
                        disabled={!mapping.clientId}
                        rightSection={categoryLoading[mapping.clientId] ? <Loader size={15} /> : undefined}
                        data={categoryOptions.map((item) => ({ value: item.label, label: item.label }))}
                        value={mapping.expectedCategoryName || null}
                        onChange={(value) => updateMapping(destination, { expectedCategoryName: value || "" })}
                      />
                      {products.length > 0 && (
                        <Accordion variant="contained">
                          <Accordion.Item value="products">
                            <Accordion.Control>Exceções por produto ({products.length})</Accordion.Control>
                            <Accordion.Panel>
                              <Stack gap="xs">
                                {products.map((product) => (
                                  <Select
                                    key={product}
                                    label={product}
                                    placeholder="Usar categoria padrão"
                                    searchable
                                    clearable
                                    disabled={!mapping.clientId}
                                    data={categoryOptions.map((item) => ({ value: item.label, label: item.label }))}
                                    value={mapping.productCategories[product] || null}
                                    onChange={(value) => updateMapping(destination, {
                                      productCategories: { ...mapping.productCategories, [product]: value || "" },
                                    })}
                                  />
                                ))}
                              </Stack>
                            </Accordion.Panel>
                          </Accordion.Item>
                        </Accordion>
                      )}
                    </Stack>
                  </Paper>
                );
              })}
            </SimpleGrid>
            <Group justify="flex-end">
              <Button
                size="md"
                leftSection={<IconRefresh size={18} />}
                loading={comparing}
                disabled={!canSupervise || !periodEntries.length}
                onClick={compare}
              >
                Conferir no Conta Azul
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {result && (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 2, md: 4, xl: 8 }} spacing="sm">
            {[
              ["Planilha", result.summary.spreadsheetRows, "blue"],
              ["Conferidos", result.summary.ok, "green"],
              ["Categoria", result.summary.wrongCategory, "orange"],
              ["Não encontrados", result.summary.notFound, "red"],
              ["Data próxima", result.summary.nearbyDate, "yellow"],
              ["Duplicidades", result.summary.ambiguous, "violet"],
              ["Ajustes", result.summary.negativeReview, "cyan"],
              ["Só no Conta Azul", result.summary.extraContaAzul, "gray"],
            ].map(([label, value, color]) => (
              <Paper key={String(label)} withBorder radius="md" p="md">
                <Text size="xs" c="dimmed">{label}</Text>
                <Text fw={900} fz={24} c={String(color)}>{value}</Text>
              </Paper>
            ))}
          </SimpleGrid>

          <Alert color={result.summary.ok === result.summary.spreadsheetRows ? "green" : "orange"} icon={result.summary.ok === result.summary.spreadsheetRows ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}>
            <Text fw={700}>{money(result.summary.matchedAmount)} conferidos de {money(result.summary.spreadsheetAmount)}</Text>
            <Text size="sm">O valor precisa ser idêntico até os centavos. Data próxima é apenas uma sugestão e não recebe status de conferido.</Text>
          </Alert>

          <Paper withBorder radius="lg" className={styles.resultsCard}>
            <Group justify="space-between" p="md" wrap="wrap">
              <div>
                <Text fw={800}>Resultado da planilha</Text>
                <Text size="sm" c="dimmed">{filteredRows.length} linha(s) nos filtros atuais</Text>
              </div>
              <Group>
                <Select
                  w={220}
                  data={[
                    { value: "ALL", label: "Todos os resultados" },
                    ...Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label })),
                  ]}
                  value={statusFilter}
                  onChange={(value) => { setStatusFilter(value); setPage(1); }}
                />
                <TextInput w={280} leftSection={<IconSearch size={16} />} placeholder="Cliente, produto ou descrição" value={search} onChange={(event) => { setSearch(event.currentTarget.value); setPage(1); }} />
              </Group>
            </Group>
            <Table.ScrollContainer minWidth={1250}>
              <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>DATA PG</Table.Th>
                    <Table.Th>Cliente / produto</Table.Th>
                    <Table.Th>Destino</Table.Th>
                    <Table.Th ta="right">Valor</Table.Th>
                    <Table.Th>Categoria esperada</Table.Th>
                    <Table.Th>Lançamento no Conta Azul</Table.Th>
                    <Table.Th>Categoria no Conta Azul</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pagedRows.map((row) => <ResultRow key={row.id} row={row} />)}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {!pagedRows.length && <Text ta="center" c="dimmed" p="xl">Nenhuma linha encontrada nos filtros.</Text>}
            {filteredRows.length > pageSize && (
              <Group justify="center" p="md">
                <Pagination value={page} onChange={setPage} total={Math.ceil(filteredRows.length / pageSize)} />
              </Group>
            )}
          </Paper>

          <Accordion variant="contained">
            <Accordion.Item value="extras">
              <Accordion.Control>Receitas encontradas somente no Conta Azul ({result.extraContaAzul.length})</Accordion.Control>
              <Accordion.Panel>
                <Table.ScrollContainer minWidth={900}>
                  <Table verticalSpacing="sm">
                    <Table.Thead><Table.Tr><Table.Th>Cadastro</Table.Th><Table.Th>Datas</Table.Th><Table.Th>Descrição / contato</Table.Th><Table.Th>Categoria</Table.Th><Table.Th ta="right">Valor</Table.Th></Table.Tr></Table.Thead>
                    <Table.Tbody>
                      {result.extraContaAzul.slice(0, 300).map((item) => (
                        <Table.Tr key={`${item.clientId}:${item.id}`}>
                          <Table.Td>{item.clientName}</Table.Td>
                          <Table.Td><Text size="xs">Pgto. {date(item.paymentDate)}<br />Comp. {date(item.competenceDate)}<br />Venc. {date(item.dueDate)}</Text></Table.Td>
                          <Table.Td><Text fw={600} size="sm">{item.description}</Text><Text size="xs" c="dimmed">{item.counterparty || "Sem contato"}</Text></Table.Td>
                          <Table.Td>{item.categoryNames.join(" / ") || "—"}</Table.Td>
                          <Table.Td ta="right" fw={700}>{money(item.amount)}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
                {result.extraContaAzul.length > 300 && <Text size="xs" c="dimmed" mt="sm">A tela exibe os primeiros 300 itens. O relatório exportado contém todos.</Text>}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      )}
    </main>
  );
}

function ResultRow({ row }: { row: SalesReconciliationRow }) {
  const meta = STATUS_META[row.status];
  const matchedDate = row.matchedDateField === "PAYMENT"
    ? "pagamento"
    : row.matchedDateField === "COMPETENCE"
      ? "competência"
      : row.matchedDateField === "DUE"
        ? "vencimento"
        : null;
  return (
    <Table.Tr>
      <Table.Td>
        <Badge color={meta.color} variant="light">{meta.label}</Badge>
        <Text size="xs" c="dimmed" mt={4} maw={210}>{row.statusDetail}</Text>
      </Table.Td>
      <Table.Td>{date(row.paymentDate)}<Text size="xs" c="dimmed">Linha {row.sourceRow}</Text></Table.Td>
      <Table.Td><Text fw={650} size="sm">{row.customer || "Sem cliente"}</Text><Text size="xs" c="dimmed">{row.product || "Sem produto"}</Text></Table.Td>
      <Table.Td>{row.destinationLabel || "—"}</Table.Td>
      <Table.Td ta="right" fw={750}>{money(row.amount)}</Table.Td>
      <Table.Td>{row.expectedCategory || "Não validada"}</Table.Td>
      <Table.Td>
        {row.contaAzul ? <><Text fw={650} size="sm">{row.contaAzul.description}</Text><Text size="xs" c="dimmed">{row.contaAzul.counterparty || "Sem contato"}{matchedDate ? ` · data de ${matchedDate}` : ""}</Text></> : "—"}
      </Table.Td>
      <Table.Td>{row.contaAzul?.categoryNames.join(" / ") || "—"}</Table.Td>
    </Table.Tr>
  );
}
