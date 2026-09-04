import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const HISTORY = /^(\d{5})\s+(\d{3})\s+(.+)$/;
const MONEY_WITH_INDICATOR = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*([CD])";

type AmountWithIndicator = {
  value: number;
  indicator: "C" | "D";
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

function iso(value: string) {
  const [day, month, year] = value.split("/");
  return `${year}-${month}-${day}`;
}

function money(value: string, indicator: string) {
  const amount = Number(value.replace(/\./g, "").replace(",", "."));
  return indicator.toUpperCase() === "D" ? -Math.abs(amount) : Math.abs(amount);
}

function amountsFrom(value: string): AmountWithIndicator[] {
  return [...value.matchAll(new RegExp(MONEY_WITH_INDICATOR, "gi"))].map((match) => ({
    value: money(match[1], match[2]),
    indicator: match[2].toUpperCase() as "C" | "D",
  }));
}

function sourceType(description: string) {
  const key = normalize(description);
  if (key.includes("PIX - RECEBIDO") || key.includes("PIX-RECEBIDO")) return "PIX recebido";
  if (key.includes("PIX - ENVIADO")) return "PIX enviado";
  if (key.includes("COBRANCA COM REGISTRO")) return "Cobrança";
  if (key.includes("PAGAMENTO DE BOLETO")) return "Pagamento de boleto";
  if (key.includes("FOLHA DE PAGAMENTO")) return "Folha de pagamento";
  if (key.includes("PAGTO CARTAO CREDITO")) return "Pagamento de cartão";
  if (key.includes("TED-CREDITO")) return "TED recebido";
  if (key.includes("IMPOSTOS")) return "Impostos";
  if (key.includes("TARIFA")) return "Tarifa bancária";
  if (key.includes("SEGURO")) return "Seguro";
  if (key.includes("CONSORCIO")) return "Consórcio";
  if (key.includes("AMORTIZACAO") || key.includes("GIRO")) return "Financiamento";
  return "Movimentação";
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function labelValue(lines: PdfTextLine[], label: string) {
  const normalizedLabel = normalize(label);
  for (const line of lines) {
    const labelIndex = line.parts.findIndex((part) => normalize(part.text) === normalizedLabel);
    if (labelIndex < 0) continue;
    return clean(line.parts.slice(labelIndex + 1).map((part) => part.text).join(" "));
  }
  return undefined;
}

function continuationText(line: PdfTextLine) {
  if (line.parts.length !== 1) return undefined;
  const part = line.parts[0];
  if (part.x < 240 || part.x >= 455) return undefined;
  const value = clean(part.text);
  if (!value || amountsFrom(value).length || /^[-*]+$/.test(value)) return undefined;
  return value;
}

export function parseBancoDoBrasilStatement(source: PdfTextLine[]): ParsedStatement {
  const lines = source.filter((line) => clean(line.text));
  const joined = lines.map((line) => line.text).join("\n");
  const normalized = normalize(joined);
  if (
    !normalized.includes("EXTRATO DE CONTA CORRENTE") ||
    !normalized.includes("AGENCIA") ||
    !normalized.includes("CONTA CORRENTE") ||
    !normalized.includes("DT. BALANCETE")
  ) {
    throw new Error("O arquivo não corresponde ao layout de extrato do Banco do Brasil configurado.");
  }

  const branch = labelValue(lines, "Agência");
  const accountAndHolder = labelValue(lines, "Conta corrente");
  const accountMatch = accountAndHolder?.match(/^([\d.-]+)\s*(.*)$/);
  const account = accountMatch?.[1];
  const accountHolder = clean(accountMatch?.[2] ?? "") || undefined;

  let detectedOpeningBalance: number | undefined;
  let detectedClosingBalance: number | undefined;
  let currentTransaction: StatementTransaction | undefined;
  const declaredBalances = new Map<number, number>();
  const transactions: StatementTransaction[] = [];

  for (const line of lines) {
    const datePart = line.parts.find((part) => part.x < 100 && DATE.test(part.text));
    const historyPart = line.parts.find((part) => part.x >= 210 && part.x < 360 && HISTORY.test(clean(part.text)));

    if (datePart && historyPart) {
      const historyMatch = clean(historyPart.text).match(HISTORY);
      if (!historyMatch) continue;

      const description = clean(historyMatch[3]);
      const compactDescription = normalize(description).replace(/\s/g, "");
      const tail = clean(
        line.parts
          .filter((part) => part.x >= 360)
          .map((part) => part.text)
          .join(" "),
      );
      const amounts = amountsFrom(tail);

      if (normalize(description) === "SALDO ANTERIOR") {
        detectedOpeningBalance = amounts[0]?.value;
        currentTransaction = undefined;
        continue;
      }
      if (compactDescription === "SALDO") {
        detectedClosingBalance = amounts.at(-1)?.value;
        currentTransaction = undefined;
        continue;
      }
      if (!amounts.length) {
        currentTransaction = undefined;
        continue;
      }

      const document = clean(tail.replace(new RegExp(MONEY_WITH_INDICATOR, "gi"), ""));
      const signedAmount = amounts[0].value;
      currentTransaction = {
        id: transactions.length + 1,
        selected: true,
        date: iso(datePart.text),
        description,
        document: document || `${historyMatch[1]}-${historyMatch[2]}-${transactions.length + 1}`,
        sourceType: sourceType(description),
        type: signedAmount >= 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(signedAmount),
        balance: null,
        status: description.length >= 3 ? "OK" : "REVIEW",
        warning: description.length >= 3 ? undefined : "Descrição incompleta",
      };
      transactions.push(currentTransaction);
      if (amounts[1]) declaredBalances.set(currentTransaction.id, amounts[1].value);
      continue;
    }

    const continuation = currentTransaction ? continuationText(line) : undefined;
    if (currentTransaction && continuation) {
      currentTransaction.description = clean(`${currentTransaction.description} ${continuation}`);
    }
  }

  if (detectedOpeningBalance === undefined) {
    throw new Error("O saldo anterior do extrato do Banco do Brasil não foi identificado.");
  }
  if (detectedClosingBalance === undefined) {
    throw new Error("O saldo final do extrato do Banco do Brasil não foi identificado.");
  }
  if (!transactions.length) {
    throw new Error("Nenhuma movimentação foi encontrada no extrato do Banco do Brasil.");
  }

  let runningBalance = detectedOpeningBalance;
  for (const transaction of transactions) {
    runningBalance = Number(
      (runningBalance + (transaction.type === "CREDIT" ? transaction.amount : -transaction.amount)).toFixed(2),
    );
    const declaredBalance = declaredBalances.get(transaction.id);
    if (declaredBalance !== undefined && Math.abs(runningBalance - declaredBalance) >= 0.01) {
      throw new Error(
        `A leitura ficou incompleta perto do lançamento ${transaction.document}: o saldo calculado não corresponde ao extrato.`,
      );
    }
    transaction.balance = runningBalance;
  }

  if (Math.abs(runningBalance - detectedClosingBalance) >= 0.01) {
    throw new Error(
      `A leitura do extrato do Banco do Brasil ficou incompleta: o saldo calculado foi R$ ${formatMoney(runningBalance)}, mas o extrato informa R$ ${formatMoney(detectedClosingBalance)}.`,
    );
  }

  return {
    bank: "Banco do Brasil",
    accountHolder,
    branch,
    account,
    periodStart: transactions[0].date,
    periodEnd: transactions.at(-1)?.date,
    detectedOpeningBalance,
    detectedClosingBalance,
    transactions,
  };
}
