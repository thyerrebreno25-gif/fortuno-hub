import type { ParsedStatement, StatementTransaction } from "../types";

const MONEY = "\\d{1,3}(?:\\.\\d{3})*,\\d{2}";
const TRANSACTION_ROW = new RegExp(
  `^(\\d{2}\\/\\d{2}\\/\\d{4})\\s*-\\s*[0-9O]{2}\\s*:?\\s*\\d{2}\\s*:\\s*\\d{2}\\s+(\\d{5,})\\s+(.+?)\\s+(${MONEY})\\s*([CD])\\s+(${MONEY})\\s*([CD])$`,
  "i",
);

function clean(value: string) {
  return String(value ?? "")
    .replace(/[|]/g, " ")
    .replace(/[—–−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function money(value: string, indicator = "C") {
  const amount = Number(value.replace(/\./g, "").replace(",", "."));
  return indicator.toUpperCase() === "D" ? -Math.abs(amount) : Math.abs(amount);
}

function iso(value: string) {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

function sourceType(description: string) {
  const key = normalize(description);
  if (key.startsWith("PIX RECEBIDO")) return "PIX recebido";
  if (key.startsWith("TARIFA")) return "Tarifa";
  if (key.startsWith("DEBITO")) return "Débito";
  if (key.includes("JUROS")) return "Juros";
  return "Movimentação";
}

function totalOf(transactions: StatementTransaction[], type: "CREDIT" | "DEBIT") {
  return Number(
    transactions
      .filter((transaction) => transaction.type === type)
      .reduce((sum, transaction) => sum + transaction.amount, 0)
      .toFixed(2),
  );
}

export function parseCaixaStatement(source: string[]): ParsedStatement {
  const lines = source.map(clean).filter(Boolean);
  const joined = lines.join("\n");
  const normalized = normalize(joined);
  const isPeriodStatement = normalized.includes("EXTRATO POR PERIODO");
  const isAccountStatement = normalized.includes("EXTRATO DA CONTA");
  if (!normalized.includes("CAIXA") || (!isPeriodStatement && !isAccountStatement)) {
    throw new Error("O arquivo não corresponde ao layout de extrato da Caixa configurado.");
  }

  const holder = lines
    .find((line) => /^Cliente\b/i.test(line))
    ?.replace(/^Cliente\s*/i, "")
    .trim();
  const accountMatch = joined.match(/Conta\s+(\d+)\s*\/\s*([\d.-]+)/i);
  const periodMatch = joined.match(
    /Per[ií]odo dos lan[cç]amentos\s+(\d{2}\/\d{2}\/\d{4})\s+at[eé]\s+(\d{2}\/\d{2}\/\d{4})/i,
  );
  const statementDate = joined.match(
    /(?:^|\n)Data\s+(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*\d{2}:\d{2})?/i,
  )?.[1];
  const openingMatch = joined.match(
    new RegExp(`SALDO ANTERIOR\\s+(?:R\\$\\s*)?(${MONEY})\\s*([CD])`, "i"),
  );
  if (isPeriodStatement && !periodMatch) {
    throw new Error("O período do extrato da Caixa não foi identificado.");
  }
  if (!openingMatch) {
    throw new Error("O saldo anterior do extrato da Caixa não foi identificado.");
  }

  const balanceRows: Array<{ date: string; balance: number }> = [];
  const transactions: StatementTransaction[] = [];
  for (const line of lines) {
    const match = line.match(TRANSACTION_ROW);
    if (!match) continue;

    const date = iso(match[1]);
    const description = clean(match[3]);
    const signedAmount = money(match[4], match[5]);
    const balance = money(match[6], match[7]);
    if (/^SALDO DIA$/i.test(description)) {
      balanceRows.push({ date, balance });
      continue;
    }
    if (signedAmount === 0) continue;

    transactions.push({
      id: 0,
      selected: true,
      date,
      description,
      document: match[2],
      sourceType: sourceType(description),
      type: signedAmount >= 0 ? "CREDIT" : "DEBIT",
      amount: Math.abs(signedAmount),
      balance,
      status: description.length >= 4 ? "OK" : "REVIEW",
      warning: description.length >= 4 ? undefined : "Descrição incompleta",
    });
  }

  if (!transactions.length) {
    throw new Error("Nenhuma movimentação foi encontrada no extrato da Caixa.");
  }

  transactions.sort((left, right) => left.date.localeCompare(right.date));
  transactions.forEach((transaction, index) => {
    transaction.id = index + 1;
  });
  balanceRows.sort((left, right) => left.date.localeCompare(right.date));

  const detectedOpeningBalance = money(openingMatch[1], openingMatch[2]);
  const latestBalance = balanceRows.at(-1)?.balance ?? transactions.at(-1)?.balance;
  if (latestBalance === undefined || latestBalance === null) {
    throw new Error("O saldo final do extrato da Caixa não foi identificado.");
  }
  const calculatedClosingBalance = Number(
    (
      detectedOpeningBalance +
      totalOf(transactions, "CREDIT") -
      totalOf(transactions, "DEBIT")
    ).toFixed(2),
  );
  if (Math.abs(calculatedClosingBalance - latestBalance) >= 0.01) {
    throw new Error(
      "A leitura do extrato da Caixa ficou incompleta: o saldo inicial e as movimentações não fecham com o saldo final.",
    );
  }

  const firstTransactionDate = transactions[0]?.date;
  const lastTransactionDate = transactions.at(-1)?.date;
  const periodStart = periodMatch ? iso(periodMatch[1]) : firstTransactionDate;
  const periodEnd = periodMatch
    ? iso(periodMatch[2])
    : statementDate
      ? iso(statementDate)
      : lastTransactionDate;

  return {
    bank: "Caixa",
    accountHolder: holder,
    branch: accountMatch?.[1],
    account: accountMatch?.[2],
    periodStart,
    periodEnd,
    detectedOpeningBalance,
    detectedClosingBalance: latestBalance,
    transactions,
  };
}
