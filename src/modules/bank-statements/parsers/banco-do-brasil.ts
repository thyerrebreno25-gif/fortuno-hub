import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const ZERO_DATE = /^00\/00\/0000$/;
const HISTORY = /^(\d{5})\s+(\d{3})\s+(.+)$/;
const MONEY_WITH_INDICATOR = "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*([CD])";
const MONEY_WITH_PARENTHESIS_INDICATOR =
  "(\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\s*\\(([+-])\\)";

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

function parenthesisAmountsFrom(value: string): AmountWithIndicator[] {
  return [
    ...value.matchAll(new RegExp(MONEY_WITH_PARENTHESIS_INDICATOR, "gi")),
  ].map((match) => ({
    value:
      match[2] === "-"
        ? -Math.abs(money(match[1], "C"))
        : Math.abs(money(match[1], "C")),
    indicator: match[2] === "-" ? "D" : "C",
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
  if (key.includes("BB RENDE FACIL")) return "Aplicação automática";
  if (key.includes("CIELO VENDAS")) return "Recebimento";
  if (key.includes("CONSORCIO")) return "Consórcio";
  if (
    key.includes("AMORTIZACAO") ||
    key.includes("EMPRESTIMO") ||
    key.includes("GIRO")
  ) {
    return "Financiamento";
  }
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

type JasperRecord = {
  date: string;
  lot?: string;
  document?: string;
  descriptions: string[];
  signedAmount?: number;
};

function addJasperDescription(record: JasperRecord, value: string) {
  const description = clean(value);
  const normalizedDescription = normalize(description);
  if (!normalizedDescription) return;

  const alreadyCovered = record.descriptions.some((current) => {
    const normalizedCurrent = normalize(current);
    return (
      normalizedCurrent === normalizedDescription ||
      normalizedCurrent.includes(normalizedDescription)
    );
  });
  if (!alreadyCovered) record.descriptions.push(description);
}

function jasperDescriptionParts(line: PdfTextLine) {
  return line.parts
    .filter((part) => part.x >= 250 && part.x < 500)
    .map((part) => clean(part.text))
    .filter((value) => {
      const key = normalize(value);
      return (
        Boolean(value) &&
        key !== "HISTORICO" &&
        !parenthesisAmountsFrom(value).length
      );
    });
}

function addJasperLine(record: JasperRecord, line: PdfTextLine) {
  const lot = line.parts.find(
    (part) => part.x >= 70 && part.x < 140 && /^\d+$/.test(clean(part.text)),
  );
  const document = line.parts.find(
    (part) => part.x >= 140 && part.x < 250 && /^\d+$/.test(clean(part.text)),
  );
  const amounts = parenthesisAmountsFrom(line.text);

  if (!record.lot && lot) record.lot = clean(lot.text);
  if (!record.document && document) record.document = clean(document.text);
  if (record.signedAmount === undefined && amounts.length) {
    record.signedAmount = amounts.at(-1)?.value;
  }
  jasperDescriptionParts(line).forEach((value) =>
    addJasperDescription(record, value),
  );
}

function parseJasperBancoDoBrasilStatement(
  lines: PdfTextLine[],
): ParsedStatement {
  const accountHeader = lines.find((line) => {
    const key = normalize(line.text);
    return key.includes("AGENCIA:") && key.includes("CONTA:");
  });
  const accountHeaderMatch = accountHeader?.text.match(
    /Ag[eê]ncia:\s*([\d.-]+).*?Conta:\s*([\d.-]+)/i,
  );
  const accountHolder = labelValue(lines, "Cliente");
  const branch = accountHeaderMatch?.[1];
  const account = accountHeaderMatch?.[2];

  let detectedOpeningBalance: number | undefined;
  let detectedClosingBalance: number | undefined;
  let insideTransactions = false;
  let current: JasperRecord | undefined;
  let pendingDescriptions: string[] = [];
  const transactions: StatementTransaction[] = [];

  function finishCurrent() {
    if (!current) return;

    const description = clean(current.descriptions.join(" "));
    const descriptionKey = normalize(description).replace(/\s/g, "");
    const signedAmount = current.signedAmount;

    if (descriptionKey === "SALDOANTERIOR") {
      detectedOpeningBalance = signedAmount;
    } else if (descriptionKey === "SALDO") {
      detectedClosingBalance = signedAmount;
    } else if (
      descriptionKey !== "SALDODODIA" &&
      signedAmount !== undefined
    ) {
      const id = transactions.length + 1;
      transactions.push({
        id,
        selected: true,
        date: iso(current.date),
        description: description || "Movimentação Banco do Brasil",
        document:
          current.document ||
          [current.lot, String(id)].filter(Boolean).join("-") ||
          String(id),
        sourceType: sourceType(description),
        type: signedAmount >= 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(signedAmount),
        balance: null,
        status: description.length >= 3 ? "OK" : "REVIEW",
        warning: description.length >= 3 ? undefined : "Descrição incompleta",
      });
    }

    current = undefined;
  }

  for (const line of lines) {
    const lineKey = normalize(line.text);

    if (lineKey === "LANCAMENTOS") {
      insideTransactions = true;
      continue;
    }
    if (!insideTransactions) continue;
    if (lineKey.startsWith("INFORMACOES ADICIONAIS")) {
      finishCurrent();
      break;
    }
    if (
      lineKey === "DIA LOTE DOCUMENTO HISTORICO VALOR" ||
      lineKey === "DIA" ||
      lineKey === "LOTE" ||
      lineKey === "DOCUMENTO" ||
      lineKey === "HISTORICO" ||
      lineKey === "VALOR"
    ) {
      continue;
    }

    const datePart = line.parts.find(
      (part) => part.x < 80 && (DATE.test(clean(part.text)) || ZERO_DATE.test(clean(part.text))),
    );
    const descriptions = jasperDescriptionParts(line);

    if (datePart && ZERO_DATE.test(clean(datePart.text))) {
      finishCurrent();
      pendingDescriptions = [];
      continue;
    }

    if (datePart && DATE.test(clean(datePart.text))) {
      finishCurrent();
      current = {
        date: clean(datePart.text),
        descriptions: pendingDescriptions,
      };
      pendingDescriptions = [];
      addJasperLine(current, line);
      continue;
    }

    if (!descriptions.length && !parenthesisAmountsFrom(line.text).length) {
      continue;
    }

    const startsNextPix = descriptions.some((description) =>
      /^PIX\s*-?\s*RECEBIDO$/i.test(normalize(description)),
    );
    if (current?.signedAmount !== undefined && startsNextPix) {
      finishCurrent();
      pendingDescriptions = descriptions;
      continue;
    }

    if (current) {
      addJasperLine(current, line);
    } else if (descriptions.length) {
      pendingDescriptions = descriptions;
    }
  }
  finishCurrent();

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
      (
        runningBalance +
        (transaction.type === "CREDIT" ? transaction.amount : -transaction.amount)
      ).toFixed(2),
    );
    transaction.balance = runningBalance;
  }

  if (Math.abs(runningBalance - detectedClosingBalance) >= 0.01) {
    throw new Error(
      `A leitura do novo layout do Banco do Brasil ficou incompleta: o saldo calculado foi R$ ${formatMoney(runningBalance)}, mas o extrato informa R$ ${formatMoney(detectedClosingBalance)}.`,
    );
  }

  return {
    bank: "Banco do Brasil",
    layout: "bb-jasper-conta-corrente",
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

export function parseBancoDoBrasilStatement(source: PdfTextLine[]): ParsedStatement {
  const lines = source.filter((line) => clean(line.text));
  const joined = lines.map((line) => line.text).join("\n");
  const normalized = normalize(joined);

  const isJasperLayout =
    normalized.includes("EXTRATO DE CONTA CORRENTE") &&
    normalized.includes("CLIENTE") &&
    normalized.includes("LANCAMENTOS") &&
    normalized.includes("SALDO DO DIA") &&
    /\(\s*[+-]\s*\)/.test(joined);
  if (isJasperLayout) {
    return parseJasperBancoDoBrasilStatement(lines);
  }

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
