"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Loader,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Stepper,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowRight,
  IconCheck,
  IconCloudUpload,
  IconCoins,
  IconDownload,
  IconFileSpreadsheet,
  IconPlus,
  IconRefresh,
  IconScale,
  IconTrash,
} from "@tabler/icons-react";
import type {
  CurrencyOption,
  CurrencyTransaction,
  ExchangeRateResponse,
} from "@/modules/currency/types";
import {
  parsePdfWithSummary,
  type PdfParserAudit,
} from "@/modules/currency/parsers/pdf-parser";
import { parseSpreadsheet } from "@/modules/currency/parsers/spreadsheet-parser";
import {
  downloadTextFile,
  generateCurrencyOfx,
} from "@/modules/currency/services/ofx-generator";
import { formatDateBR } from "@/modules/currency/utils/date";
import { formatMoney } from "@/modules/currency/utils/number";

type RateMode = "SELL" | "BUY";

export default function CurrencyConversionPage() {
  const [step, setStep] = useState(0);
  const [currencies, setCurrencies] = useState<CurrencyOption[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [rateMode, setRateMode] = useState<RateMode>("SELL");
  const [file, setFile] = useState<File | null>(null);
  const [transactions, setTransactions] = useState<CurrencyTransaction[]>([]);
  const [loadingCurrencies, setLoadingCurrencies] = useState(true);
  const [processingFile, setProcessingFile] = useState(false);
  const [loadingRates, setLoadingRates] = useState(false);
  const [error, setError] = useState("");
  const [bankId, setBankId] = useState("000");
  const [accountId, setAccountId] = useState("FORTUNOHUB");
  const [accountType, setAccountType] =
    useState<"CHECKING" | "SAVINGS">("CHECKING");
  const [openingBalance, setOpeningBalance] = useState<number | string>("");
  const [statementClosingBalance, setStatementClosingBalance] =
    useState<number | string>("");
  const [closingBalanceDetected, setClosingBalanceDetected] = useState(false);
  const [parserAudit, setParserAudit] = useState<PdfParserAudit | null>(null);
  const [closingBalanceRate, setClosingBalanceRate] = useState<number | null>(null);
  const [closingBalanceRateDate, setClosingBalanceRateDate] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    async function loadCurrencies() {
      try {
        setLoadingCurrencies(true);
        const response = await fetch("/api/currency/currencies", {
          cache: "no-store",
        });
        const result = (await response.json()) as {
          currencies?: CurrencyOption[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(result.error || "Não foi possível carregar as moedas.");
        }

        setCurrencies(result.currencies ?? []);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Não foi possível carregar as moedas.",
        );
      } finally {
        setLoadingCurrencies(false);
      }
    }

    void loadCurrencies();
  }, []);

  const currencyOptions = useMemo(
    () =>
      currencies.map((item) => ({
        value: item.symbol,
        label: `${item.symbol} — ${item.name}`,
      })),
    [currencies],
  );

  const convertedCount = transactions.filter(
    (item) => item.status === "CONVERTED",
  ).length;

  const pendingCount = transactions.filter(
    (item) => item.status === "PENDING",
  ).length;

  const errorCount = transactions.filter(
    (item) => item.status === "ERROR",
  ).length;

  const totalOriginal = transactions.reduce(
    (total, item) => total + item.originalAmount,
    0,
  );

  const totalConverted = transactions.reduce(
    (total, item) => total + (item.convertedAmount ?? 0),
    0,
  );

  const totalCredits = transactions.reduce(
    (total, item) =>
      total + (item.type === "CREDIT" ? item.originalAmount : 0),
    0,
  );

  const totalDebits = transactions.reduce(
    (total, item) =>
      total + (item.type === "DEBIT" ? item.originalAmount : 0),
    0,
  );

  const openingBalanceNumber =
    typeof openingBalance === "number" ? openingBalance : Number(openingBalance);
  const statementClosingBalanceNumber =
    typeof statementClosingBalance === "number"
      ? statementClosingBalance
      : Number(statementClosingBalance);
  const hasOpeningBalance = Number.isFinite(openingBalanceNumber);
  const hasStatementClosingBalance = Number.isFinite(
    statementClosingBalanceNumber,
  );
  const calculatedClosingBalance = hasOpeningBalance
    ? Number((openingBalanceNumber + totalCredits - totalDebits).toFixed(2))
    : null;
  const balanceDifference =
    calculatedClosingBalance !== null && hasStatementClosingBalance
      ? Number(
          (calculatedClosingBalance - statementClosingBalanceNumber).toFixed(2),
        )
      : null;
  const balanceMatches =
    balanceDifference !== null && Math.abs(balanceDifference) <= 0.01;

  const netTransactions = Number((totalCredits - totalDebits).toFixed(2));
  const validatedClosingBalance =
    balanceMatches && hasStatementClosingBalance
      ? statementClosingBalanceNumber
      : null;
  const convertedClosingBalance =
    validatedClosingBalance !== null && closingBalanceRate !== null
      ? Number((validatedClosingBalance * closingBalanceRate).toFixed(2))
      : null;

  async function processSelectedFile() {
    if (!file) {
      setError("Selecione um arquivo PDF, XLSX, XLS ou CSV.");
      return;
    }

    try {
      setProcessingFile(true);
      setError("");
      setClosingBalanceRate(null);
      setClosingBalanceRateDate(null);

      const extension = file.name.split(".").pop()?.toLowerCase();
      let parsed: CurrencyTransaction[] = [];

      if (extension === "pdf") {
        const result = await parsePdfWithSummary(file, currency);
        parsed = result.transactions;
        setParserAudit(result.audit);

        if (result.detectedClosingBalance !== null) {
          setStatementClosingBalance(result.detectedClosingBalance);
          setClosingBalanceDetected(true);
        } else {
          setStatementClosingBalance("");
          setClosingBalanceDetected(false);
        }
      } else if (["xlsx", "xls", "csv"].includes(extension ?? "")) {
        setStatementClosingBalance("");
        setClosingBalanceDetected(false);
        setParserAudit(null);
        parsed = await parseSpreadsheet(file, currency);
      } else {
        throw new Error("Formato não suportado.");
      }

      if (parsed.length === 0) {
        throw new Error(
          "Nenhuma movimentação foi identificada. Verifique o arquivo ou ajuste o layout.",
        );
      }

      const source =
        extension === "pdf" ? "PDF" : "SPREADSHEET";

      setTransactions(
        parsed.map((item) => ({
          ...item,
          currency: item.currency || currency,
          source: item.source ?? source,
        })),
      );
      setStep(1);

      notifications.show({
        color: "green",
        title: "Arquivo processado",
        message: `${parsed.length} movimentação(ões) identificada(s).`,
      });
    } catch (processError) {
      setError(
        processError instanceof Error
          ? processError.message
          : "Não foi possível processar o arquivo.",
      );
    } finally {
      setProcessingFile(false);
    }
  }

  async function loadAllRates() {
    if (transactions.length === 0) return;

    try {
      cancelledRef.current = false;
      setLoadingRates(true);
      setError("");

      const uniqueKeys = [
        ...new Set(
          transactions.map((item) => `${item.currency}|${item.date}`),
        ),
      ];

      const rates = new Map<string, ExchangeRateResponse | Error>();

      // Processamento em lotes pequenos para não sobrecarregar a API do BCB.
      for (let index = 0; index < uniqueKeys.length; index += 4) {
        if (cancelledRef.current) break;

        const batch = uniqueKeys.slice(index, index + 4);

        const results = await Promise.all(
          batch.map(async (key) => {
            const [itemCurrency, date] = key.split("|");

            try {
              const response = await fetch(
                `/api/currency/rates?currency=${encodeURIComponent(itemCurrency)}&date=${encodeURIComponent(date)}`,
                { cache: "no-store" },
              );
              const result = (await response.json()) as
                | ExchangeRateResponse
                | { error?: string };

              if (!response.ok || !("sellRate" in result)) {
                throw new Error(
                  "error" in result && result.error
                    ? result.error
                    : "Cotação não encontrada.",
                );
              }

              return [key, result] as const;
            } catch (rateError) {
              return [
                key,
                rateError instanceof Error
                  ? rateError
                  : new Error("Cotação não encontrada."),
              ] as const;
            }
          }),
        );

        results.forEach(([key, result]) => rates.set(key, result));
      }

      const statementDate = transactions
        .map((item) => item.date)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0];

      if (statementDate) {
        const statementRateResult = rates.get(`${currency}|${statementDate}`);

        if (statementRateResult && !(statementRateResult instanceof Error)) {
          setClosingBalanceRate(
            rateMode === "SELL"
              ? statementRateResult.sellRate
              : statementRateResult.buyRate,
          );
          setClosingBalanceRateDate(statementRateResult.rateDate);
        } else {
          setClosingBalanceRate(null);
          setClosingBalanceRateDate(null);
        }
      }

      setTransactions((current) =>
        current.map((transaction) => {
          const key = `${transaction.currency}|${transaction.date}`;
          const result = rates.get(key);

          if (!result || result instanceof Error) {
            return {
              ...transaction,
              status: "ERROR",
              warning:
                result instanceof Error
                  ? result.message
                  : "Cotação não encontrada.",
            };
          }

          const rate = rateMode === "SELL" ? result.sellRate : result.buyRate;

          return {
            ...transaction,
            rate,
            rateDate: result.rateDate,
            rateSource: result.source,
            convertedAmount: Number(
              (transaction.originalAmount * rate).toFixed(2),
            ),
            status: "CONVERTED",
            warning: result.usedPreviousBusinessDay
              ? `Sem PTAX em ${formatDateBR(transaction.date)}; utilizado o último dia útil anterior (${formatDateBR(result.rateDate)}).`
              : undefined,
          };
        }),
      );

      setStep(2);
    } catch (rateError) {
      setError(
        rateError instanceof Error
          ? rateError.message
          : "Não foi possível buscar as cotações.",
      );
    } finally {
      setLoadingRates(false);
    }
  }

  function updateTransaction(
    id: string,
    updates: Partial<CurrencyTransaction>,
  ) {
    if (
      "date" in updates ||
      "currency" in updates ||
      "originalAmount" in updates ||
      "type" in updates
    ) {
      setClosingBalanceRate(null);
      setClosingBalanceRateDate(null);
    }

    setTransactions((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              ...updates,
              status:
                "date" in updates ||
                "currency" in updates ||
                "originalAmount" in updates
                  ? "PENDING"
                  : item.status,
              rate:
                "date" in updates ||
                "currency" in updates ||
                "originalAmount" in updates
                  ? null
                  : item.rate,
              convertedAmount:
                "date" in updates ||
                "currency" in updates ||
                "originalAmount" in updates
                  ? null
                  : item.convertedAmount,
            }
          : item,
      ),
    );
  }

  function removeTransaction(id: string) {
    setTransactions((current) => current.filter((item) => item.id !== id));
  }

  function addManualTransaction(options?: {
    amount?: number;
    type?: "CREDIT" | "DEBIT";
    description?: string;
  }) {
    const latestDate =
      transactions
        .map((item) => item.date)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0] ??
      new Date().toISOString().slice(0, 10);

    const transaction: CurrencyTransaction = {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: latestDate,
      description: options?.description ?? "Lançamento manual",
      originalAmount: Math.abs(options?.amount ?? 0),
      currency,
      rate: null,
      rateDate: null,
      rateSource: null,
      convertedAmount: null,
      type: options?.type ?? "DEBIT",
      status: "PENDING",
      source: "MANUAL",
    };

    setTransactions((current) => [transaction, ...current]);
    setClosingBalanceRate(null);
    setClosingBalanceRateDate(null);
    setStep(1);

    notifications.show({
      color: "blue",
      title: "Lançamento manual adicionado",
      message:
        "Preencha os dados da nova linha e depois busque a PTAX novamente.",
    });
  }

  function addBalanceAdjustment() {
    if (balanceDifference === null || balanceMatches) return;

    addManualTransaction({
      amount: Math.abs(balanceDifference),
      type: balanceDifference > 0 ? "DEBIT" : "CREDIT",
      description: "Ajuste manual para fechamento do saldo",
    });
  }

  function exportOfx() {
    try {
      const ofx = generateCurrencyOfx(transactions, {
        bankId,
        accountId,
        accountType,
      });

      downloadTextFile(
        ofx,
        `convertnow-cambio-${new Date().toISOString().slice(0, 10)}.ofx`,
        "application/x-ofx;charset=utf-8",
      );

      notifications.show({
        color: "green",
        title: "OFX gerado",
        message: "O arquivo está pronto para importação no Conta Azul.",
      });
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : "Não foi possível gerar o OFX.",
      );
    }
  }

  function reset() {
    cancelledRef.current = true;
    setFile(null);
    setTransactions([]);
    setOpeningBalance("");
    setStatementClosingBalance("");
    setClosingBalanceDetected(false);
    setParserAudit(null);
    setClosingBalanceRate(null);
    setClosingBalanceRateDate(null);
    setStep(0);
    setError("");
  }

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Text size="xs" fw={800} c="blue" tt="uppercase">
            Conversões
          </Text>
          <Title order={2}>Conversão inteligente de moedas</Title>
          <Text c="dimmed">
            Leia PDF ou planilhas, aplique a PTAX de cada movimentação e gere
            um OFX em reais para o Conta Azul.
          </Text>
        </Stack>

        <Button
          variant="default"
          leftSection={<IconRefresh size={17} />}
          onClick={reset}
        >
          Novo processamento
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }}>
        <Paper withBorder radius="lg" p="lg">
          <Text size="sm" c="dimmed">Movimentações</Text>
          <Text fw={800} fz={28}>{transactions.length}</Text>
        </Paper>
        <Paper withBorder radius="lg" p="lg">
          <Text size="sm" c="dimmed">Status da validação</Text>
          <Text fw={800} fz={22} c={balanceMatches ? "green" : "dimmed"}>
            {balanceMatches ? "Saldo confere" : "Aguardando"}
          </Text>
        </Paper>
        <Paper withBorder radius="lg" p="lg">
          <Text size="sm" c="dimmed">Saldo final original</Text>
          <Text fw={800} fz={22}>
            {validatedClosingBalance === null
              ? "-"
              : `${validatedClosingBalance.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })} ${currency}`}
          </Text>
        </Paper>
        <Paper withBorder radius="lg" p="lg">
          <Text size="sm" c="dimmed">Saldo final convertido</Text>
          <Text fw={800} fz={22}>
            {convertedClosingBalance === null
              ? "-"
              : formatMoney(convertedClosingBalance)}
          </Text>
          {closingBalanceRateDate && (
            <Text size="xs" c="dimmed">
              PTAX de {formatDateBR(closingBalanceRateDate)}
            </Text>
          )}
        </Paper>
      </SimpleGrid>

      <Paper withBorder radius="lg" p="lg">
        <Stepper active={step} allowNextStepsSelect={false}>
          <Stepper.Step label="Importar" description="PDF ou planilha" />
          <Stepper.Step label="Identificar" description="Revisar dados" />
          <Stepper.Step label="Cotações" description="PTAX por data" />
          <Stepper.Step label="Exportar" description="OFX Conta Azul" />
        </Stepper>
      </Paper>

      {error && (
        <Alert color="red" withCloseButton onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {step === 0 && (
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <Group>
              <ThemeIcon size={52} radius="xl" variant="light">
                <IconCloudUpload size={26} />
              </ThemeIcon>
              <Stack gap={0}>
                <Title order={4}>Importar arquivo internacional</Title>
                <Text size="sm" c="dimmed">
                  Formatos aceitos: PDF, XLSX, XLS e CSV.
                </Text>
              </Stack>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <Select
                label="Moeda padrão do arquivo"
                searchable
                value={currency}
                onChange={(value) => setCurrency(value || "USD")}
                data={currencyOptions}
                disabled={loadingCurrencies}
                rightSection={loadingCurrencies ? <Loader size="xs" /> : null}
                nothingFoundMessage="Moeda não encontrada"
              />

              <Select
                label="Cotação usada na conversão"
                value={rateMode}
                onChange={(value) =>
                  setRateMode((value as RateMode | null) ?? "SELL")
                }
                data={[
                  { value: "SELL", label: "Cotação de venda PTAX" },
                  { value: "BUY", label: "Cotação de compra PTAX" },
                ]}
                allowDeselect={false}
              />
            </SimpleGrid>

            <FileInput
              label="Arquivo"
              placeholder="Selecione ou arraste o arquivo"
              value={file}
              onChange={setFile}
              accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              leftSection={<IconFileSpreadsheet size={18} />}
              clearable
            />

            <Alert color="blue">
              Cada movimentação será convertida pela cotação correspondente à
              própria data. Em finais de semana e feriados, o sistema utilizará
              o último dia útil anterior e deixará isso visível para revisão.
            </Alert>

            <Group justify="flex-end">
              <Button
                onClick={processSelectedFile}
                loading={processingFile}
                rightSection={<IconArrowRight size={17} />}
              >
                Ler arquivo
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {step >= 1 && transactions.length > 0 && (
        <Paper withBorder radius="lg" p="lg">
          <Stack gap="md">
            <Group>
              <ThemeIcon size={44} radius="xl" variant="light" color="blue">
                <IconScale size={22} />
              </ThemeIcon>
              <Stack gap={0}>
                <Title order={4}>Validação do saldo</Title>
                <Text size="sm" c="dimmed">
                  Saldo inicial + entradas − saídas = saldo final calculado.
                </Text>
              </Stack>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }}>
              <NumberInput
                label={`Saldo inicial (${currency})`}
                placeholder="Informe o saldo no início do período"
                value={openingBalance}
                onChange={setOpeningBalance}
                decimalScale={2}
                thousandSeparator="."
                decimalSeparator=","
                allowNegative
              />

              <NumberInput
                label={`Saldo final do extrato (${currency})`}
                description={
                  closingBalanceDetected
                    ? "Identificado automaticamente no PDF"
                    : "Informe para comparar"
                }
                value={statementClosingBalance}
                onChange={(value) => {
                  setStatementClosingBalance(value);
                  setClosingBalanceDetected(false);
                }}
                decimalScale={2}
                thousandSeparator="."
                decimalSeparator=","
                allowNegative
              />

              <Paper withBorder radius="md" p="md">
                <Text size="xs" c="dimmed">Entradas</Text>
                <Text fw={800} c="green">
                  + {totalCredits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} {currency}
                </Text>
              </Paper>

              <Paper withBorder radius="md" p="md">
                <Text size="xs" c="dimmed">Saídas</Text>
                <Text fw={800} c="red">
                  − {totalDebits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} {currency}
                </Text>
              </Paper>

              <Paper withBorder radius="md" p="md">
                <Text size="xs" c="dimmed">Saldo final calculado</Text>
                <Text fw={800}>
                  {calculatedClosingBalance === null
                    ? "Informe o saldo inicial"
                    : `${calculatedClosingBalance.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} ${currency}`}
                </Text>
              </Paper>
            </SimpleGrid>

            <Paper withBorder radius="md" p="md">
              <Stack gap="sm">
                <Text fw={700}>Fluxo de fechamento do extrato</Text>
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 6 }}>
                  <Paper withBorder radius="sm" p="sm">
                    <Text size="xs" c="dimmed">1. Saldo inicial</Text>
                    <Text fw={700}>
                      {hasOpeningBalance
                        ? `${openingBalanceNumber.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })} ${currency}`
                        : "-"}
                    </Text>
                  </Paper>

                  <Paper withBorder radius="sm" p="sm">
                    <Text size="xs" c="dimmed">2. Lançamentos líquidos</Text>
                    <Text fw={700} c={netTransactions >= 0 ? "green" : "red"}>
                      {netTransactions >= 0 ? "+" : "−"}{" "}
                      {Math.abs(netTransactions).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      {currency}
                    </Text>
                  </Paper>

                  <Paper withBorder radius="sm" p="sm">
                    <Text size="xs" c="dimmed">3. Saldo calculado</Text>
                    <Text fw={700}>
                      {calculatedClosingBalance === null
                        ? "-"
                        : `${calculatedClosingBalance.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })} ${currency}`}
                    </Text>
                  </Paper>

                  <Paper withBorder radius="sm" p="sm">
                    <Text size="xs" c="dimmed">4. Bate?</Text>
                    <Badge
                      color={balanceMatches ? "green" : "red"}
                      variant="light"
                      size="lg"
                    >
                      {balanceDifference === null
                        ? "Aguardando"
                        : balanceMatches
                          ? "Sim"
                          : "Não"}
                    </Badge>
                  </Paper>

                  <Paper withBorder radius="sm" p="sm">
                    <Text size="xs" c="dimmed">5. Saldo total em {currency}</Text>
                    <Text fw={700}>
                      {validatedClosingBalance === null
                        ? "-"
                        : validatedClosingBalance.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}
                    </Text>
                  </Paper>

                  <Paper withBorder radius="sm" p="sm">
                    <Text size="xs" c="dimmed">6. Saldo total em BRL</Text>
                    <Text fw={700}>
                      {convertedClosingBalance === null
                        ? "Buscar PTAX"
                        : formatMoney(convertedClosingBalance)}
                    </Text>
                  </Paper>
                </SimpleGrid>
              </Stack>
            </Paper>

            {balanceDifference !== null && (
              <Alert color={balanceMatches ? "green" : "red"}>
                <Group justify="space-between" align="center">
                  <Text size="sm">
                    {balanceMatches
                      ? "Saldo validado. O saldo calculado confere com o saldo final do extrato."
                      : `Saldo não confere. Diferença líquida de ${Math.abs(
                          balanceDifference,
                        ).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })} ${currency}. Isso normalmente indica lançamento ausente, duplicado ou classificado com o tipo incorreto.`}
                  </Text>

                  {!balanceMatches && (
                    <Button
                      size="xs"
                      variant="light"
                      color="red"
                      leftSection={<IconPlus size={15} />}
                      onClick={addBalanceAdjustment}
                    >
                      Adicionar ajuste de {Math.abs(
                        balanceDifference,
                      ).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      {currency}
                    </Button>
                  )}
                </Group>
              </Alert>
            )}

            {parserAudit && (
              <Paper withBorder radius="md" p="md">
                <Stack gap="xs">
                  <Group justify="space-between">
                    <Stack gap={0}>
                      <Text fw={700}>Auditoria da leitura</Text>
                      <Text size="xs" c="dimmed">
                        Conferência entre linhas candidatas do PDF e movimentações efetivamente geradas.
                      </Text>
                    </Stack>
                    <Badge
                      color={
                        parserAudit.candidateLines === parserAudit.parsedTransactions
                          ? "green"
                          : "orange"
                      }
                      variant="light"
                    >
                      {parserAudit.parsedTransactions} movimentação(ões)
                    </Badge>
                  </Group>

                  <SimpleGrid cols={{ base: 1, sm: 3 }}>
                    <Paper withBorder radius="sm" p="sm">
                      <Text size="xs" c="dimmed">Linhas lidas</Text>
                      <Text fw={700}>{parserAudit.totalLines}</Text>
                    </Paper>
                    <Paper withBorder radius="sm" p="sm">
                      <Text size="xs" c="dimmed">Linhas com valor + saldo</Text>
                      <Text fw={700}>{parserAudit.candidateLines}</Text>
                    </Paper>
                    <Paper withBorder radius="sm" p="sm">
                      <Text size="xs" c="dimmed">Movimentações criadas</Text>
                      <Text fw={700}>{parserAudit.parsedTransactions}</Text>
                    </Paper>
                  </SimpleGrid>

                  {parserAudit.discardedCandidates.length > 0 && (
                    <Alert color="orange" title="Linhas que precisam de revisão">
                      <Stack gap={4}>
                        {parserAudit.discardedCandidates.slice(0, 5).map((item, index) => (
                          <Text key={`${index}-${item}`} size="xs">
                            {index + 1}. {item}
                          </Text>
                        ))}
                      </Stack>
                    </Alert>
                  )}

                  {!balanceMatches && balanceDifference !== null && (
                    <Text size="sm" fw={600} c="red">
                      Valor líquido que ainda precisa ser localizado:
                      {" "}
                      {Math.abs(balanceDifference).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                      {" "}
                      {currency}
                    </Text>
                  )}
                </Stack>
              </Paper>
            )}
          </Stack>
        </Paper>
      )}

      {step >= 1 && transactions.length > 0 && (
        <Paper withBorder radius="lg">
          <Group justify="space-between" p="lg">
            <Stack gap={2}>
              <Title order={4}>Movimentações identificadas</Title>
              <Text size="sm" c="dimmed">
                Revise as datas, observações, moedas e valores antes de buscar
                as cotações.
              </Text>
            </Stack>

            <Group>
              <Button
                variant="light"
                leftSection={<IconPlus size={16} />}
                onClick={() => addManualTransaction()}
              >
                Adicionar lançamento
              </Button>

              {pendingCount > 0 && (
                <Badge color="yellow" variant="light">
                  {pendingCount} pendente(s)
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge color="red" variant="light">
                  {errorCount} erro(s)
                </Badge>
              )}
              {convertedCount > 0 && (
                <Badge color="green" variant="light">
                  {convertedCount} convertida(s)
                </Badge>
              )}
            </Group>
          </Group>

          {loadingRates && (
            <Stack px="lg" pb="lg" gap="xs">
              <Group justify="space-between">
                <Text size="sm" fw={600}>
                  Consultando Banco Central...
                </Text>
                <Text size="sm" c="dimmed">
                  Uma cotação para cada data
                </Text>
              </Group>
              <Progress value={100} animated />
            </Stack>
          )}

          <Table.ScrollContainer minWidth={1370}>
            <Table verticalSpacing="sm" horizontalSpacing="md" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Origem</Table.Th>
                  <Table.Th>Data</Table.Th>
                  <Table.Th>Observação</Table.Th>
                  <Table.Th>Tipo</Table.Th>
                  <Table.Th>Moeda</Table.Th>
                  <Table.Th>Valor original</Table.Th>
                  <Table.Th>Cotação</Table.Th>
                  <Table.Th>Data da cotação</Table.Th>
                  <Table.Th>Valor em BRL</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>

              <Table.Tbody>
                {transactions.map((transaction) => (
                  <Table.Tr key={transaction.id}>
                    <Table.Td>
                      <Badge
                        color={
                          transaction.source === "MANUAL"
                            ? "blue"
                            : transaction.source === "PDF"
                              ? "grape"
                              : "gray"
                        }
                        variant="light"
                      >
                        {transaction.source === "MANUAL"
                          ? "Manual"
                          : transaction.source === "PDF"
                            ? "PDF"
                            : "Planilha"}
                      </Badge>
                    </Table.Td>

                    <Table.Td>
                      <TextInput
                        type="date"
                        value={transaction.date}
                        onChange={(event) =>
                          updateTransaction(transaction.id, {
                            date: event.currentTarget.value,
                          })
                        }
                        w={145}
                      />
                    </Table.Td>

                    <Table.Td>
                      <TextInput
                        value={transaction.description}
                        onChange={(event) =>
                          updateTransaction(transaction.id, {
                            description: event.currentTarget.value,
                          })
                        }
                        w={260}
                      />
                      {transaction.warning && (
                        <Text size="xs" c="orange" mt={4} maw={260}>
                          {transaction.warning}
                        </Text>
                      )}
                    </Table.Td>

                    <Table.Td>
                      <Select
                        value={transaction.type}
                        onChange={(value) =>
                          updateTransaction(transaction.id, {
                            type:
                              value === "CREDIT" ? "CREDIT" : "DEBIT",
                          })
                        }
                        data={[
                          { value: "DEBIT", label: "Saída" },
                          { value: "CREDIT", label: "Entrada" },
                        ]}
                        w={110}
                        allowDeselect={false}
                      />
                    </Table.Td>

                    <Table.Td>
                      <Select
                        searchable
                        value={transaction.currency}
                        onChange={(value) =>
                          updateTransaction(transaction.id, {
                            currency: value || currency,
                          })
                        }
                        data={currencyOptions}
                        w={125}
                      />
                    </Table.Td>

                    <Table.Td>
                      <NumberInput
                        value={transaction.originalAmount}
                        onChange={(value) =>
                          updateTransaction(transaction.id, {
                            originalAmount: Number(value) || 0,
                          })
                        }
                        decimalScale={8}
                        min={0}
                        w={140}
                      />
                    </Table.Td>

                    <Table.Td>
                      {transaction.rate
                        ? transaction.rate.toLocaleString("pt-BR", {
                            minimumFractionDigits: 4,
                            maximumFractionDigits: 8,
                          })
                        : "-"}
                    </Table.Td>

                    <Table.Td>
                      {formatDateBR(transaction.rateDate)}
                    </Table.Td>

                    <Table.Td>
                      {transaction.convertedAmount !== null
                        ? formatMoney(transaction.convertedAmount)
                        : "-"}
                    </Table.Td>

                    <Table.Td>
                      <Badge
                        color={
                          transaction.status === "CONVERTED"
                            ? "green"
                            : transaction.status === "ERROR"
                              ? "red"
                              : "yellow"
                        }
                        variant="light"
                      >
                        {transaction.status === "CONVERTED"
                          ? "Convertido"
                          : transaction.status === "ERROR"
                            ? "Erro"
                            : "Pendente"}
                      </Badge>
                    </Table.Td>

                    <Table.Td>
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        onClick={() => removeTransaction(transaction.id)}
                        aria-label="Excluir movimentação"
                      >
                        <IconTrash size={17} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Group justify="space-between" p="lg">
            <Button variant="default" onClick={() => setStep(0)}>
              Voltar
            </Button>

            <Button
              onClick={loadAllRates}
              loading={loadingRates}
              leftSection={<IconCoins size={17} />}
              disabled={!balanceMatches}
            >
              Buscar PTAX e converter saldo final
            </Button>
          </Group>
        </Paper>
      )}

      {step >= 2 && convertedCount > 0 && (
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="lg">
            <Group>
              <ThemeIcon color="green" size={46} radius="xl">
                <IconCheck size={24} />
              </ThemeIcon>
              <Stack gap={0}>
                <Title order={4}>Preparar OFX para o Conta Azul</Title>
                <Text size="sm" c="dimmed">
                  O arquivo será gerado em BRL, preservando no histórico a
                  moeda original, a PTAX e a data da cotação.
                </Text>
              </Stack>
            </Group>

            <SimpleGrid cols={{ base: 1, md: 3 }}>
              <TextInput
                label="Código do banco"
                value={bankId}
                onChange={(event) => setBankId(event.currentTarget.value)}
              />
              <TextInput
                label="Conta de destino"
                value={accountId}
                onChange={(event) => setAccountId(event.currentTarget.value)}
              />
              <Select
                label="Tipo da conta"
                value={accountType}
                onChange={(value) =>
                  setAccountType(
                    value === "SAVINGS" ? "SAVINGS" : "CHECKING",
                  )
                }
                data={[
                  { value: "CHECKING", label: "Conta corrente" },
                  { value: "SAVINGS", label: "Conta poupança" },
                ]}
                allowDeselect={false}
              />
            </SimpleGrid>

            <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
              <Paper withBorder radius="md" p="md">
                <Text size="sm" c="dimmed">Saldo final validado</Text>
                <Text fw={800} fz={24}>
                  {validatedClosingBalance === null
                    ? "-"
                    : `${validatedClosingBalance.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })} ${currency}`}
                </Text>
              </Paper>
              <Paper withBorder radius="md" p="md">
                <Text size="sm" c="dimmed">PTAX do fechamento</Text>
                <Text fw={800} fz={24}>
                  {closingBalanceRate === null
                    ? "-"
                    : closingBalanceRate.toLocaleString("pt-BR", {
                        minimumFractionDigits: 4,
                        maximumFractionDigits: 8,
                      })}
                </Text>
                <Text size="xs" c="dimmed">
                  {closingBalanceRateDate
                    ? formatDateBR(closingBalanceRateDate)
                    : "Data não disponível"}
                </Text>
              </Paper>
              <Paper withBorder radius="md" p="md">
                <Text size="sm" c="dimmed">Saldo final em BRL</Text>
                <Text fw={800} fz={24}>
                  {convertedClosingBalance === null
                    ? "-"
                    : formatMoney(convertedClosingBalance)}
                </Text>
              </Paper>
              <Paper withBorder radius="md" p="md">
                <Text size="sm" c="dimmed">Movimentações convertidas</Text>
                <Text fw={800} fz={24}>{convertedCount}</Text>
                <Text size="xs" c="dimmed">
                  Volume movimentado: {formatMoney(totalConverted)}
                </Text>
              </Paper>
            </SimpleGrid>

            <Group justify="flex-end">
              <Button
                leftSection={<IconDownload size={18} />}
                onClick={exportOfx}
                disabled={convertedCount === 0 || !balanceMatches}
              >
                Gerar OFX
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
