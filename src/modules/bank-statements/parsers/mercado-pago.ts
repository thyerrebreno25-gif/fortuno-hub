import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const DATE = /^\d{2}-\d{2}-\d{4}$/;
const OPERATION_ID = /^\d{10,}$/;
const MONEY = /^R\$\s*-?\d{1,3}(?:\.\d{3})*,\d{2}$/;

type MovementAnchor = {
  line: PdfTextLine;
  date: string;
  document: string;
  signedAmount: number;
  balance: number;
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
  return Number(
    value
      .replace(/R\$/gi, "")
      .replace(/\s/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
}

function iso(value: string) {
  const [day, month, year] = value.split("-");
  return `${year}-${month}-${day}`;
}

function findMoneyAfterLabel(lines: PdfTextLine[], label: RegExp) {
  for (const line of lines) {
    const labelIndex = line.parts.findIndex((part) => label.test(normalize(part.text)));
    if (labelIndex < 0) continue;
    const value = line.parts.slice(labelIndex + 1).find((part) => MONEY.test(part.text));
    if (value) return money(value.text);
  }
  return undefined;
}

function movementAnchor(line: PdfTextLine): MovementAnchor | null {
  const date = line.parts.find((part) => DATE.test(part.text))?.text;
  const document = line.parts.find((part) => OPERATION_ID.test(part.text))?.text;
  const amounts = line.parts.filter((part) => MONEY.test(part.text)).map((part) => money(part.text));
  if (!date || !document || amounts.length < 2) return null;
  return {
    line,
    date: iso(date),
    document,
    signedAmount: amounts[0],
    balance: amounts.at(-1) as number,
  };
}

function descriptionCandidates(pageLines: PdfTextLine[]) {
  return pageLines
    .flatMap((line) => line.parts.map((part) => ({ ...part, y: line.y })))
    .filter((part) => part.x >= 80 && part.x < 190)
    .filter((part) => normalize(part.text) !== "DESCRICAO");
}

function nearestAnchor(part: { y: number }, anchors: MovementAnchor[]) {
  return anchors.reduce((best, candidate) =>
    Math.abs(candidate.line.y - part.y) < Math.abs(best.line.y - part.y) ? candidate : best,
  );
}

function descriptionFor(anchor: MovementAnchor, candidates: Array<{ y: number; text: string }>, anchors: MovementAnchor[]) {
  const descriptionParts = candidates
    .filter((part) => {
      const nearest = nearestAnchor(part, anchors);
      return nearest === anchor && Math.abs(anchor.line.y - part.y) <= 20;
    })
    .sort((left, right) => right.y - left.y)
    .map((part) => clean(part.text));
  return clean(descriptionParts.join(" "));
}

function sourceType(description: string) {
  const key = normalize(description);
  if (key.startsWith("PAGAMENTO COM CODIGO QR")) return "Pagamento com Código QR";
  if (key.startsWith("LIBERACAO DE DINHEIRO")) return "Liberação de dinheiro";
  if (key.startsWith("RESERVA POR VENDAS")) return "Reserva por vendas";
  if (key.startsWith("DINHEIRO RESERVADO")) return "Dinheiro reservado";
  if (key.startsWith("DINHEIRO RETIRADO")) return "Dinheiro retirado";
  if (key.startsWith("DINHEIRO RECEBIDO")) return "Dinheiro recebido";
  if (key.startsWith("RESERVA PROGRAMADA")) return "Reserva programada";
  if (key.startsWith("PIX ENVIADO")) return "Pix enviado";
  if (key.startsWith("PIX RECEBIDO")) return "Pix recebido";
  if (key.startsWith("PIX ")) return "Pix";
  if (key.startsWith("RECARGA")) return "Recarga";
  if (key.startsWith("PAGAMENTO")) return "Pagamento";
  if (key.startsWith("TARIFA")) return "Tarifa";
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

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseMercadoPagoStatement(source: PdfTextLine[]): ParsedStatement {
  const lines = source.filter((line) => clean(line.text));
  const joined = lines.map((line) => line.text).join("\n");
  const normalized = normalize(joined);
  if (
    !normalized.includes("EXTRATO DE CONTA") ||
    !normalized.includes("ID DA OPERACAO") ||
    !normalized.includes("PERIODO: DE")
  ) {
    throw new Error("O arquivo não corresponde ao layout de extrato do Mercado Pago configurado.");
  }

  const periodMatch = joined.match(/Per[ií]odo:\s*De\s+(\d{2}-\d{2}-\d{4})\s+a[l-té]+\s+(\d{2}-\d{2}-\d{4})/i);
  const accountMatch = joined.match(/CPF\/CNPJ:\s*\d+\s+Ag[eê]ncia:\s*(\S+)\s+Conta:\s*(\S+)/i);
  const headerIndex = lines.findIndex((line) => normalize(line.text) === "EXTRATO DE CONTA");
  const holder = headerIndex >= 0 ? clean(lines[headerIndex + 1]?.text ?? "") : undefined;
  const detectedOpeningBalance = findMoneyAfterLabel(lines, /^SALDO INICIAL:/);
  const detectedClosingBalance = findMoneyAfterLabel(lines, /^SALDO FINAL:/);
  const declaredCredits = findMoneyAfterLabel(lines, /^ENTRADAS:/);
  const declaredSignedDebits = findMoneyAfterLabel(lines, /^SAIDAS:/);
  if (!periodMatch || detectedOpeningBalance === undefined || detectedClosingBalance === undefined) {
    throw new Error("O período e os saldos do extrato do Mercado Pago não foram identificados.");
  }
  if (declaredCredits === undefined || declaredSignedDebits === undefined) {
    throw new Error("Os totais de entradas e saídas do extrato do Mercado Pago não foram identificados.");
  }

  const transactions: StatementTransaction[] = [];
  const pageNumbers = [...new Set(lines.map((line) => line.page))];
  let pendingDescription: string[] = [];
  for (const page of pageNumbers) {
    const pageLines = lines.filter((line) => line.page === page);
    const anchors = pageLines.map(movementAnchor).filter((anchor): anchor is MovementAnchor => Boolean(anchor));
    if (!anchors.length) continue;
    const candidates = descriptionCandidates(pageLines);
    for (const [anchorIndex, anchor] of anchors.entries()) {
      const ownDescription = descriptionFor(anchor, candidates, anchors);
      const description = clean(
        anchorIndex === 0 && pendingDescription.length
          ? `${pendingDescription.join(" ")} ${ownDescription}`
          : ownDescription,
      );
      transactions.push({
        id: transactions.length + 1,
        selected: true,
        date: anchor.date,
        description: description || "Movimentação Mercado Pago",
        document: anchor.document,
        sourceType: sourceType(description),
        type: anchor.signedAmount >= 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(anchor.signedAmount),
        balance: anchor.balance,
        status: description ? "OK" : "REVIEW",
        warning: description ? undefined : "Descrição não identificada",
      });
    }
    const lastAnchor = anchors.at(-1) as MovementAnchor;
    pendingDescription = candidates
      .filter((part) => part.y < lastAnchor.line.y)
      .filter((part) => Math.abs(nearestAnchor(part, anchors).line.y - part.y) > 20)
      .sort((left, right) => right.y - left.y)
      .map((part) => clean(part.text));
  }

  if (!transactions.length) {
    throw new Error("Nenhuma movimentação foi encontrada no extrato do Mercado Pago.");
  }

  const detectedCredits = totalOf(transactions, "CREDIT");
  const detectedDebits = totalOf(transactions, "DEBIT");
  const declaredDebits = Math.abs(declaredSignedDebits);
  if (Math.abs(detectedCredits - declaredCredits) >= 0.01) {
    throw new Error(
      `A leitura das entradas ficou incompleta: foram identificados R$ ${formatMoney(detectedCredits)}, mas o extrato informa R$ ${formatMoney(declaredCredits)}.`,
    );
  }
  if (Math.abs(detectedDebits - declaredDebits) >= 0.01) {
    throw new Error(
      `A leitura das saídas ficou incompleta: foram identificados R$ ${formatMoney(detectedDebits)}, mas o extrato informa R$ ${formatMoney(declaredDebits)}.`,
    );
  }

  let runningBalance = detectedOpeningBalance;
  for (const transaction of transactions) {
    runningBalance = Number(
      (runningBalance + (transaction.type === "CREDIT" ? transaction.amount : -transaction.amount)).toFixed(2),
    );
    if (transaction.balance === null || Math.abs(runningBalance - transaction.balance) >= 0.01) {
      throw new Error(
        `O saldo após a operação ${transaction.document} não fecha com as movimentações identificadas.`,
      );
    }
  }
  if (Math.abs(runningBalance - detectedClosingBalance) >= 0.01) {
    throw new Error("A leitura do extrato do Mercado Pago não fecha com o saldo final informado.");
  }

  return {
    bank: "Mercado Pago",
    accountHolder: holder,
    branch: accountMatch?.[1],
    account: accountMatch?.[2],
    periodStart: iso(periodMatch[1]),
    periodEnd: iso(periodMatch[2]),
    detectedOpeningBalance,
    detectedClosingBalance,
    transactions,
  };
}
