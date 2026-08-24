import type { ParsedStatement, StatementTransaction } from "../types";

const MONEY_SOURCE = "-?R\\$\\s*\\d{1,3}(?:\\.\\d{3})*,\\d{2}";
const TRANSACTION_ROW = new RegExp(
  `^(\\d{2}\\/\\d{2})\\s+(\\d{2}\\/\\d{2})\\s+(.+?)\\s+(${MONEY_SOURCE})$`,
);
const DAILY_BALANCE = new RegExp(
  `^Saldo do dia (\\d{2}\\/\\d{2}\\/\\d{2})\\s+(${MONEY_SOURCE})$`,
  "i",
);

const TRANSACTION_TYPES = [
  "Devolução PIX",
  "Transferência",
  "Débito automático",
  "Entrada PIX",
  "Saída PIX",
  "Pagamento",
  "Aplicação",
  "Resgate",
  "Entradas",
  "Saídas",
  "Tarifa",
  "Saque",
  "Depósito",
  "Crédito",
  "Débito",
];

function money(value: string): number {
  return Number(
    value
      .replace(/R\$/g, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
}

function iso(date: string): string {
  const [day, month, year] = date.split("/");
  return `${year.length === 2 ? `20${year}` : year}-${month}-${day}`;
}

function isoShortDate(date: string, periodStart: string, periodEnd: string): string {
  const [day, month] = date.split("/");
  const startYear = Number(periodStart.slice(0, 4));
  const endYear = Number(periodEnd.slice(0, 4));
  const startMonth = Number(periodStart.slice(5, 7));
  const year = startYear === endYear || Number(month) >= startMonth ? startYear : endYear;
  return `${year}-${month}-${day}`;
}

function splitTypeAndDescription(value: string): {
  transactionType: string;
  description: string;
  recognized: boolean;
} {
  const matchedType = TRANSACTION_TYPES.find((type) =>
    value.toLocaleLowerCase("pt-BR").startsWith(type.toLocaleLowerCase("pt-BR")),
  );
  if (!matchedType) {
    const [transactionType = "Movimentação", ...description] = value.split(/\s+/);
    return {
      transactionType,
      description: description.join(" ").trim() || value.trim(),
      recognized: false,
    };
  }
  return {
    transactionType: matchedType,
    description: value.slice(matchedType.length).trim(),
    recognized: true,
  };
}

function totalOf(transactions: StatementTransaction[], type: "CREDIT" | "DEBIT"): number {
  return Number(
    transactions
      .filter((transaction) => transaction.type === type)
      .reduce((sum, transaction) => sum + transaction.amount, 0)
      .toFixed(2),
  );
}

export function parseC6(lines: string[]): ParsedStatement {
  const joined = lines.join("\n");
  if (!/C6\s*BANK/i.test(joined) || !/Data\s+Data/i.test(joined)) {
    throw new Error("O arquivo não corresponde ao layout de extrato C6 configurado.");
  }

  const holderLine = lines.find((line) => /\s[•·]\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*$/.test(line));
  const holder = holderLine?.replace(/\s[•·]\s*\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\s*$/, "").trim();
  const accountLine = lines.find((line) => /^Agência:/i.test(line));
  const accountMatch = accountLine?.match(/Agência:\s*([^•·]+)\s*[•·]\s*Conta:\s*(\S+)/i);
  const periodMatch = joined.match(/\(\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})\s*\)/);
  if (!periodMatch) {
    throw new Error("O período do extrato C6 não foi identificado.");
  }
  const periodStart = iso(periodMatch[1]);
  const periodEnd = iso(periodMatch[2]);

  const declaredTotals = joined.match(
    new RegExp(`Entradas:\\s*(${MONEY_SOURCE.replace("-?", "")})\\s*[•·]\\s*Saídas:\\s*(${MONEY_SOURCE.replace("-?", "")})`, "i"),
  );
  if (!declaredTotals) {
    throw new Error("Os totais de entradas e saídas não foram identificados no extrato C6.");
  }
  const declaredCredits = money(declaredTotals[1]);
  const declaredDebits = money(declaredTotals[2]);

  const transactions: StatementTransaction[] = [];
  const dailyBalances = new Map<string, number>();

  for (const line of lines) {
    const balanceMatch = line.match(DAILY_BALANCE);
    if (balanceMatch) {
      dailyBalances.set(iso(balanceMatch[1]), money(balanceMatch[2]));
      continue;
    }

    const match = line.match(TRANSACTION_ROW);
    if (!match) continue;
    const signedAmount = money(match[4]);
    const parsedMiddle = splitTypeAndDescription(match[3]);
    const launchDate = isoShortDate(match[1], periodStart, periodEnd);
    const accountingDate = isoShortDate(match[2], periodStart, periodEnd);
    const validDescription = parsedMiddle.description.length >= 3;
    transactions.push({
      id: transactions.length + 1,
      selected: true,
      date: launchDate,
      accountingDate,
      description: parsedMiddle.description,
      document: "",
      sourceType: parsedMiddle.transactionType,
      type: signedAmount >= 0 ? "CREDIT" : "DEBIT",
      amount: Math.abs(signedAmount),
      balance: null,
      status: parsedMiddle.recognized && validDescription ? "OK" : "REVIEW",
      warning: !parsedMiddle.recognized
        ? "Tipo de movimentação não reconhecido automaticamente"
        : validDescription ? undefined : "Descrição incompleta",
    });
  }

  if (!transactions.length) {
    throw new Error("Nenhuma movimentação foi encontrada no extrato C6.");
  }

  for (const [balanceDate, balance] of dailyBalances) {
    const lastTransaction = transactions.findLast(
      (transaction) => transaction.accountingDate === balanceDate,
    );
    if (lastTransaction) lastTransaction.balance = balance;
  }

  const detectedCredits = totalOf(transactions, "CREDIT");
  const detectedDebits = totalOf(transactions, "DEBIT");
  if (Math.abs(detectedCredits - declaredCredits) >= 0.01) {
    throw new Error(
      `A leitura das entradas ficou incompleta: foram identificados R$ ${detectedCredits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, mas o extrato informa R$ ${declaredCredits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`,
    );
  }
  if (Math.abs(detectedDebits - declaredDebits) >= 0.01) {
    throw new Error(
      `A leitura das saídas ficou incompleta: foram identificados R$ ${detectedDebits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, mas o extrato informa R$ ${declaredDebits.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`,
    );
  }

  const closingEntry = [...dailyBalances.entries()].sort(([left], [right]) => left.localeCompare(right)).at(-1);
  if (!closingEntry) {
    throw new Error("O saldo final diário não foi identificado no extrato C6.");
  }
  const detectedClosingBalance = closingEntry[1];
  const detectedOpeningBalance = Number(
    (detectedClosingBalance - detectedCredits + detectedDebits).toFixed(2),
  );
  let runningBalance = detectedOpeningBalance;
  for (const transaction of transactions) {
    runningBalance += transaction.type === "CREDIT" ? transaction.amount : -transaction.amount;
    if (transaction.balance !== null && Math.abs(runningBalance - transaction.balance) >= 0.01) {
      throw new Error(
        `O saldo diário de ${transaction.accountingDate?.split("-").reverse().join("/")} não fecha com as movimentações identificadas.`,
      );
    }
  }

  return {
    bank: "C6 Bank",
    accountHolder: holder,
    branch: accountMatch?.[1]?.trim(),
    account: accountMatch?.[2]?.trim(),
    periodStart,
    periodEnd,
    detectedOpeningBalance,
    detectedClosingBalance,
    transactions,
  };
}
