import type { ParsedStatement, StatementTransaction } from "../types";

const MONEY = "-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}";
const TX = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4})\\s+(.+?)\\s+(${MONEY})\\s+(${MONEY})$`);

function money(value: string) {
  return Number(value.replace(/\./g, "").replace(",", "."));
}
function iso(date: string) {
  const [d, m, y] = date.split("/");
  return `${y}-${m}-${d}`;
}
function find(lines: string[], pattern: RegExp) {
  return lines.find((line) => pattern.test(line));
}
function splitDocument(middle: string) {
  const known = middle.match(/\s(PIX_(?:CRED|DEB)|CX\d+|\d{7,12}|5ODT---04|DARFC?\d*|DAS|SANESUL-G|DETRAMS-G|I\d{5})$/i);
  if (!known || known.index === undefined) return { description: middle.trim(), document: "" };
  return { description: middle.slice(0, known.index).trim(), document: known[1] };
}

export function parseSicredi(lines: string[]): ParsedStatement {
  const joined = lines.join("\n");
  if (!/Sicredi/i.test(joined) || !/SALDO ANTERIOR/i.test(joined)) {
    throw new Error("O arquivo não corresponde ao layout de extrato Sicredi configurado.");
  }

  const holder = find(lines, /^Associado:/i)?.replace(/^Associado:\s*/i, "").trim();
  const branch = find(lines, /^Cooperativa:/i)?.replace(/^Cooperativa:\s*/i, "").trim();
  const account = find(lines, /^Conta:/i)?.replace(/^Conta:\s*/i, "").trim();
  const period = joined.match(/Período de (\d{2}\/\d{2}\/\d{4}) a (\d{2}\/\d{2}\/\d{4})/i);
  const opening = joined.match(/SALDO ANTERIOR\s+(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);
  const current = joined.match(/Saldo Atual\s+R\$\s*(-?\d{1,3}(?:\.\d{3})*,\d{2})/i);

  const transactions: StatementTransaction[] = [];
  for (const line of lines) {
    const match = line.match(TX);
    if (!match) continue;
    const value = money(match[3]);
    const balance = money(match[4]);
    const parts = splitDocument(match[2]);
    transactions.push({
      id: transactions.length + 1,
      selected: true,
      date: iso(match[1]),
      description: parts.description,
      document: parts.document,
      type: value >= 0 ? "CREDIT" : "DEBIT",
      amount: Math.abs(value),
      balance,
      status: parts.description.length < 4 ? "REVIEW" : "OK",
      warning: parts.description.length < 4 ? "Descrição incompleta" : undefined,
    });
  }

  if (!transactions.length) throw new Error("Nenhuma movimentação foi encontrada no extrato Sicredi.");

  return {
    bank: "Sicredi",
    accountHolder: holder,
    branch,
    account,
    periodStart: period ? iso(period[1]) : undefined,
    periodEnd: period ? iso(period[2]) : undefined,
    detectedOpeningBalance: opening ? money(opening[1]) : undefined,
    detectedClosingBalance: current ? money(current[1]) : transactions.at(-1)?.balance ?? undefined,
    transactions,
  };
}
