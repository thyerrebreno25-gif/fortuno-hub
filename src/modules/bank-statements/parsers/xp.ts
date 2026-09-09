import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const FULL_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const DIGITAL_DATE_TIME = /^(\d{2}\/\d{2}\/\d{2,4})\s+[àa]s\s+(\d{2}:\d{2}:\d{2})$/i;
const MONEY = /^-?R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}$/i;
const MONEY_SOURCE = "-?R\\$\\s*\\d{1,3}(?:\\.\\d{3})*,\\d{2}";

type RawTransaction = {
  date: string;
  accountingDate?: string;
  description: string;
  document: string;
  signedAmount: number;
  declaredBalance: number;
  sortKey?: string;
};

type ParsedHeader = {
  accountHolder?: string;
  branch?: string;
  account?: string;
  periodStart: string;
  periodEnd: string;
  closingBalance: number;
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
  const [day, month, rawYear] = value.split("/");
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month}-${day}`;
}

function money(value: string) {
  const negative = clean(value).startsWith("-");
  const amount = Number(
    value
      .replace(/R\$/gi, "")
      .replace(/\s/g, "")
      .replace(/-/g, "")
      .replace(/\./g, "")
      .replace(",", "."),
  );
  return negative ? -amount : amount;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sourceType(description: string) {
  const key = normalize(description);
  if (key.startsWith("PIX ENVIADO")) return "PIX enviado";
  if (key.startsWith("PIX RECEBIDO")) return "PIX recebido";
  if (key.startsWith("TED RECEBIDA")) return "TED recebida";
  if (key.startsWith("TED ENVIADA")) return "TED enviada";
  if (key.startsWith("RESGATE")) return "Resgate de investimento";
  if (key.startsWith("IRRF")) return "Imposto sobre investimento";
  if (key.startsWith("TAXA")) return "Taxa";
  if (key.startsWith("DEVOLUCAO")) return "Devolução de taxa";
  if (key.startsWith("APLICACAO")) return "Aplicação";
  return "Movimentação";
}

function parseHeader(lines: PdfTextLine[], closingPattern: RegExp): ParsedHeader {
  const joined = lines.map((line) => line.text).join("\n");
  const period = joined.match(/De:\s*(\d{2}\/\d{2}\/\d{4})\s+At[eé]:\s*(\d{2}\/\d{2}\/\d{4})/i);
  const closing = joined.match(closingPattern);
  if (!period) throw new Error("O período do extrato XP não foi identificado.");
  if (!closing) throw new Error("O saldo final do extrato XP não foi identificado.");

  const accountLine = lines.find((line) => /\bConta:\s*\d+/i.test(line.text));
  const account = accountLine?.text.match(/\bConta:\s*(\d+)/i)?.[1];
  const branch = accountLine?.text.match(/Ag[eê]ncia:\s*([\d-]+)/i)?.[1];
  const accountHolder = clean(
    accountLine?.parts.find((part) => part.x < 300 && !/\b(?:Banco XP|Conta):/i.test(part.text))?.text ?? "",
  ) || undefined;

  return {
    accountHolder,
    branch,
    account,
    periodStart: iso(period[1]),
    periodEnd: iso(period[2]),
    closingBalance: money(closing[1]),
  };
}

function finalizeTransactions(raw: RawTransaction[], closingBalance: number) {
  if (!raw.length) throw new Error("Nenhuma movimentação foi encontrada no extrato XP.");

  const detectedOpeningBalance = Number((raw[0].declaredBalance - raw[0].signedAmount).toFixed(2));
  let runningBalance = detectedOpeningBalance;
  const transactions: StatementTransaction[] = raw.map((item, index) => {
    runningBalance = Number((runningBalance + item.signedAmount).toFixed(2));
    if (Math.abs(runningBalance - item.declaredBalance) >= 0.01) {
      throw new Error(
        `A leitura do extrato XP ficou incompleta perto de “${item.description}”: o saldo calculado não corresponde ao documento.`,
      );
    }
    const validDescription = item.description.length >= 3;
    return {
      id: index + 1,
      selected: true,
      date: item.date,
      accountingDate: item.accountingDate,
      description: item.description,
      document: item.document || `XP-${item.accountingDate ?? item.date}-${index + 1}`,
      sourceType: sourceType(item.description),
      type: item.signedAmount >= 0 ? "CREDIT" : "DEBIT",
      amount: Math.abs(item.signedAmount),
      balance: item.declaredBalance,
      status: validDescription ? "OK" : "REVIEW",
      warning: validDescription ? undefined : "Descrição incompleta",
    };
  });

  if (Math.abs(runningBalance - closingBalance) >= 0.01) {
    throw new Error(
      `A leitura do extrato XP ficou incompleta: o saldo calculado foi R$ ${formatMoney(runningBalance)}, mas o documento informa R$ ${formatMoney(closingBalance)}.`,
    );
  }
  return { transactions, detectedOpeningBalance };
}

function parseDigital(lines: PdfTextLine[]): ParsedStatement {
  const header = parseHeader(
    lines,
    new RegExp(`Saldo dispon[ií]vel no final do per[ií]odo filtrado:\\s*(${MONEY_SOURCE})`, "i"),
  );
  const raw: RawTransaction[] = [];

  for (const line of lines) {
    const dateTimePart = line.parts.find((part) => part.x < 120 && DIGITAL_DATE_TIME.test(clean(part.text)));
    const valuePart = line.parts.find((part) => part.x >= 390 && part.x < 490 && MONEY.test(clean(part.text)));
    const balancePart = line.parts.find((part) => part.x >= 490 && MONEY.test(clean(part.text)));
    if (!dateTimePart || !valuePart || !balancePart) continue;

    const dateTime = clean(dateTimePart.text).match(DIGITAL_DATE_TIME);
    if (!dateTime) continue;
    const date = iso(dateTime[1]);
    const description = clean(
      line.parts
        .filter((part) => part.x >= 120 && part.x < 390)
        .map((part) => part.text)
        .join(" "),
    );
    raw.push({
      date,
      description,
      document: clean(dateTimePart.text).replace(/\D/g, ""),
      signedAmount: money(valuePart.text),
      declaredBalance: money(balancePart.text),
      sortKey: `${date}T${dateTime[2]}`,
    });
  }

  raw.sort((left, right) => String(left.sortKey).localeCompare(String(right.sortKey)));
  const finalized = finalizeTransactions(raw, header.closingBalance);
  return {
    bank: "XP",
    layout: "Conta Digital",
    accountHolder: header.accountHolder,
    branch: header.branch,
    account: header.account,
    periodStart: header.periodStart,
    periodEnd: header.periodEnd,
    detectedOpeningBalance: finalized.detectedOpeningBalance,
    detectedClosingBalance: header.closingBalance,
    transactions: finalized.transactions,
  };
}

function nearestAnchor(
  candidate: { page: number; y: number },
  anchors: Array<{ line: PdfTextLine }>,
) {
  const pageAnchors = anchors.filter((anchor) => anchor.line.page === candidate.page);
  if (!pageAnchors.length) return undefined;
  return pageAnchors.reduce((best, anchor) =>
    Math.abs(anchor.line.y - candidate.y) < Math.abs(best.line.y - candidate.y) ? anchor : best,
  );
}

function parseInvestments(lines: PdfTextLine[]): ParsedStatement {
  const header = parseHeader(
    lines,
    new RegExp(`Saldo dispon[ií]vel:\\s*(${MONEY_SOURCE})`, "i"),
  );
  const anchors: Array<{
    line: PdfTextLine;
    settlementDate: string;
    movementDate: string;
    signedAmount: number;
    declaredBalance: number;
  }> = [];

  for (const line of lines) {
    const dates = line.parts.filter((part) => part.x < 190 && FULL_DATE.test(clean(part.text)));
    const valuePart = line.parts.find((part) => part.x >= 400 && part.x < 490 && MONEY.test(clean(part.text)));
    const balancePart = line.parts.find((part) => part.x >= 490 && MONEY.test(clean(part.text)));
    if (dates.length < 2 || !valuePart || !balancePart) continue;
    anchors.push({
      line,
      settlementDate: iso(dates[0].text),
      movementDate: iso(dates[1].text),
      signedAmount: money(valuePart.text),
      declaredBalance: money(balancePart.text),
    });
  }

  const candidates = lines.flatMap((line) =>
    line.parts
      .filter((part) => part.x >= 180 && part.x < 400)
      .filter((part) => normalize(part.text) !== "HISTORICO")
      .map((part) => ({ page: line.page, y: line.y, text: clean(part.text) })),
  );
  const raw = anchors.map((anchor) => {
    const description = clean(
      candidates
        .filter((candidate) => {
          const nearest = nearestAnchor(candidate, anchors);
          return nearest === anchor && Math.abs(anchor.line.y - candidate.y) <= 12;
        })
        .sort((left, right) => right.y - left.y)
        .map((candidate) => candidate.text)
        .join(" "),
    );
    const document = description.match(/\b(\d{5,})$/)?.[1] ?? "";
    return {
      date: anchor.movementDate,
      accountingDate: anchor.settlementDate,
      description: description || "Movimentação XP Investimentos",
      document,
      signedAmount: anchor.signedAmount,
      declaredBalance: anchor.declaredBalance,
    } satisfies RawTransaction;
  }).reverse();

  const finalized = finalizeTransactions(raw, header.closingBalance);
  return {
    bank: "XP",
    layout: "Investimentos",
    accountHolder: header.accountHolder,
    branch: header.branch,
    account: header.account,
    periodStart: header.periodStart,
    periodEnd: header.periodEnd,
    detectedOpeningBalance: finalized.detectedOpeningBalance,
    detectedClosingBalance: header.closingBalance,
    transactions: finalized.transactions,
  };
}

export function parseXpStatement(source: PdfTextLine[]): ParsedStatement {
  const lines = source.filter((line) => clean(line.text));
  const normalized = normalize(lines.map((line) => line.text).join("\n"));
  if (normalized.includes("CONTA DIGITAL XP") && normalized.includes("BANCO XP S.A")) {
    return parseDigital(lines);
  }
  if (normalized.includes("XP INVESTIMENTOS CORRETORA") && normalized.includes("LIQ MOV HISTORICO")) {
    return parseInvestments(lines);
  }
  throw new Error("O arquivo não corresponde a nenhum dos layouts de extrato XP configurados.");
}
