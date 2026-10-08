import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const MONEY = /^[+-]?\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;
const DATE_HEADER = /^(\d{2})\s+([A-Z]{3})\s+(\d{4})$/;
const LONG_PERIOD = /(\d{2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})\s+A\s+(\d{2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})/;

const MONTHS: Record<string, string> = {
  JANEIRO: "01",
  FEVEREIRO: "02",
  MARCO: "03",
  ABRIL: "04",
  MAIO: "05",
  JUNHO: "06",
  JULHO: "07",
  AGOSTO: "08",
  SETEMBRO: "09",
  OUTUBRO: "10",
  NOVEMBRO: "11",
  DEZEMBRO: "12",
  JAN: "01",
  FEV: "02",
  MAR: "03",
  ABR: "04",
  MAI: "05",
  JUN: "06",
  JUL: "07",
  AGO: "08",
  SET: "09",
  OUT: "10",
  NOV: "11",
  DEZ: "12",
};

type PendingTransaction = {
  page: number;
  date: string;
  type: "CREDIT" | "DEBIT";
  label: string;
  details: string[];
  amount: number;
};

function clean(value: string) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: string) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function money(value: string) {
  const normalized = clean(value);
  const negative = normalized.startsWith("-");
  const amount = Number(
    normalized
      .replace(/[+-]/g, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
  return negative ? -amount : amount;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isoDate(day: string, month: string, year: string) {
  const monthNumber = MONTHS[normalize(month)];
  if (!monthNumber) throw new Error(`O mês “${month}” do extrato Nubank não foi reconhecido.`);
  return `${year}-${monthNumber}-${day}`;
}

function sourceType(description: string) {
  const key = normalize(description);
  if (key.includes("TRANSFERENCIA RECEBIDA PELO PIX")) return "Pix recebido";
  if (key.includes("TRANSFERENCIA ENVIADA PELO PIX")) return "Pix enviado";
  if (key.includes("COMPRA NO DEBITO")) return "Compra no débito";
  if (key.includes("PAGAMENTO DE BOLETO")) return "Pagamento de boleto";
  if (key.includes("PAGAMENTO DE FATURA")) return "Pagamento de fatura";
  if (key.includes("TRANSFERENCIA RECEBIDA")) return "Transferência recebida";
  if (key.includes("TRANSFERENCIA ENVIADA")) return "Transferência enviada";
  if (key.includes("RENDIMENTO LIQUIDO")) return "Rendimento";
  if (key.includes("ESTORNO")) return "Estorno";
  if (key.includes("TARIFA")) return "Tarifa";
  return "Movimentação";
}

function findSummaryMoney(lines: PdfTextLine[], label: string) {
  const normalizedLabel = normalize(label);
  for (const line of lines) {
    const labelIndex = line.parts.findIndex(
      (part) => normalize(part.text) === normalizedLabel,
    );
    if (labelIndex < 0) continue;
    const value = line.parts
      .slice(labelIndex + 1)
      .find((part) => MONEY.test(clean(part.text)));
    if (value) return money(value.text);
  }
  return undefined;
}

function transactionAmount(line: PdfTextLine) {
  const value = [...line.parts]
    .reverse()
    .find((part) => part.x >= 470 && MONEY.test(clean(part.text)));
  return value ? Math.abs(money(value.text)) : undefined;
}

function detailParts(line: PdfTextLine) {
  return line.parts
    .filter((part) => part.x >= 240 && part.x < 470)
    .map((part) => clean(part.text))
    .filter(Boolean);
}

function totalOf(
  transactions: StatementTransaction[],
  type: "CREDIT" | "DEBIT",
) {
  return Number(
    transactions
      .filter((transaction) => transaction.type === type)
      .reduce((sum, transaction) => sum + transaction.amount, 0)
      .toFixed(2),
  );
}

export function parseNubankStatement(source: PdfTextLine[]): ParsedStatement {
  const lines = source.filter((line) => clean(line.text));
  const joined = lines.map((line) => line.text).join("\n");
  const normalized = normalize(joined);
  if (
    !normalized.includes("SALDO FINAL DO PERIODO") ||
    !normalized.includes("RENDIMENTO LIQUIDO") ||
    !normalized.includes("MOVIMENTACOES") ||
    !normalized.includes("NUBANK.COM.BR/CONTATOS#OUVIDORIA")
  ) {
    throw new Error("O arquivo não corresponde ao layout de extrato da conta Nubank configurado.");
  }

  const period = normalized.match(LONG_PERIOD);
  if (!period) throw new Error("O período do extrato Nubank não foi identificado.");
  const periodStart = isoDate(period[1], period[2], period[3]);
  const periodEnd = isoDate(period[4], period[5], period[6]);

  const headerIndex = lines.findIndex((line) => {
    const key = normalize(line.text);
    return key.includes("CNPJ") && key.includes("AGENCIA") && key.includes("CONTA");
  });
  const headerLine = headerIndex >= 0 ? lines[headerIndex] : undefined;
  const accountHolder = headerIndex > 0
    ? clean(lines[headerIndex - 1]?.text ?? "") || undefined
    : undefined;
  const branch = headerLine?.text.match(/Ag[eê]ncia\s+([\d.-]+)/i)?.[1];
  const accountLine = headerIndex >= 0
    ? lines.slice(headerIndex + 1).find(
        (line) => line.page === headerLine?.page && line.parts.some((part) => part.x >= 450),
      )
    : undefined;
  const account = accountLine?.text.match(/\d[\d.-]+/)?.[0];

  const detectedOpeningBalance = findSummaryMoney(lines, "Saldo inicial");
  const netYield = findSummaryMoney(lines, "Rendimento líquido");
  const declaredCredits = findSummaryMoney(lines, "Total de entradas");
  const declaredSignedDebits = findSummaryMoney(lines, "Total de saídas");
  const detectedClosingBalance = findSummaryMoney(lines, "Saldo final do período");
  if (
    detectedOpeningBalance === undefined ||
    netYield === undefined ||
    declaredCredits === undefined ||
    declaredSignedDebits === undefined ||
    detectedClosingBalance === undefined
  ) {
    throw new Error("Os saldos e totais do extrato Nubank não foram identificados.");
  }

  const declaredDebits = Math.abs(declaredSignedDebits);
  const transactions: StatementTransaction[] = [];
  let currentDate: string | undefined;
  let currentType: "CREDIT" | "DEBIT" | undefined;
  let currentPage: number | undefined;
  let pending: PendingTransaction | undefined;

  function finishPending() {
    if (!pending) return;
    const description = clean([pending.label, ...pending.details].join(" "));
    const id = transactions.length + 1;
    transactions.push({
      id,
      selected: true,
      date: pending.date,
      description: description || "Movimentação Nubank",
      document: `NU-${pending.date.replace(/-/g, "")}-${String(id).padStart(4, "0")}`,
      sourceType: sourceType(pending.label),
      type: pending.type,
      amount: pending.amount,
      balance: null,
      status: description.length >= 3 ? "OK" : "REVIEW",
      warning: description.length >= 3 ? undefined : "Descrição incompleta",
    });
    pending = undefined;
  }

  for (const line of lines) {
    if (currentPage !== undefined && line.page !== currentPage) {
      finishPending();
      currentType = undefined;
    }
    currentPage = line.page;

    const datePart = line.parts.find((part) => part.x < 100)?.text;
    const dateMatch = datePart ? normalize(datePart).match(DATE_HEADER) : null;
    if (dateMatch) {
      finishPending();
      currentDate = isoDate(dateMatch[1], dateMatch[2], dateMatch[3]);
      currentType = undefined;
    }

    const labelPart = line.parts.find(
      (part) => part.x >= 100 && part.x < 240,
    );
    const labelKey = normalize(labelPart?.text ?? "");

    if (labelKey === "TOTAL DE ENTRADAS" || labelKey === "TOTAL DE SAIDAS") {
      finishPending();
      currentType = labelKey === "TOTAL DE ENTRADAS" ? "CREDIT" : "DEBIT";
      continue;
    }

    if (labelKey === "SALDO DO DIA") {
      finishPending();
      const balance = transactionAmount(line);
      const lastTransaction = transactions.findLast(
        (transaction) => transaction.date === currentDate,
      );
      if (lastTransaction && balance !== undefined) lastTransaction.balance = balance;
      currentType = undefined;
      continue;
    }

    const amount = transactionAmount(line);
    if (currentDate && currentType && labelPart && amount !== undefined) {
      finishPending();
      pending = {
        page: line.page,
        date: currentDate,
        type: currentType,
        label: clean(labelPart.text),
        details: detailParts(line),
        amount,
      };
      continue;
    }

    if (pending && line.page === pending.page) {
      pending.details.push(...detailParts(line));
    }
  }
  finishPending();

  const detectedCredits = totalOf(transactions, "CREDIT");
  const detectedDebits = totalOf(transactions, "DEBIT");
  if (Math.abs(detectedCredits - declaredCredits) >= 0.01) {
    throw new Error(
      `A leitura das entradas do Nubank ficou incompleta: foram identificados R$ ${formatMoney(detectedCredits)}, mas o extrato informa R$ ${formatMoney(declaredCredits)}.`,
    );
  }
  if (Math.abs(detectedDebits - declaredDebits) >= 0.01) {
    throw new Error(
      `A leitura das saídas do Nubank ficou incompleta: foram identificados R$ ${formatMoney(detectedDebits)}, mas o extrato informa R$ ${formatMoney(declaredDebits)}.`,
    );
  }

  if (Math.abs(netYield) >= 0.005) {
    const id = transactions.length + 1;
    transactions.push({
      id,
      selected: true,
      date: periodEnd,
      description: "Rendimento líquido",
      document: `NU-${periodEnd.replace(/-/g, "")}-RENDIMENTO`,
      sourceType: "Rendimento",
      type: netYield >= 0 ? "CREDIT" : "DEBIT",
      amount: Math.abs(netYield),
      balance: detectedClosingBalance,
      status: "OK",
    });
  }

  const calculatedClosing = Number(
    (
      detectedOpeningBalance +
      declaredCredits -
      declaredDebits +
      netYield
    ).toFixed(2),
  );
  if (Math.abs(calculatedClosing - detectedClosingBalance) >= 0.01) {
    throw new Error(
      `O extrato Nubank não fechou: o saldo calculado foi R$ ${formatMoney(calculatedClosing)}, mas o documento informa R$ ${formatMoney(detectedClosingBalance)}.`,
    );
  }

  return {
    bank: "Nubank",
    layout: "Conta PJ",
    accountHolder,
    branch,
    account,
    periodStart,
    periodEnd,
    detectedOpeningBalance,
    detectedClosingBalance,
    transactions,
  };
}
