import type { StatementTransaction } from "./types";

type GenerateOfxInput = {
  bankId: string;
  institutionName?: string;
  branch?: string;
  account?: string;
  initialBalance: number;
  finalBalance: number;
  transactions: StatementTransaction[];
};

const institutionNames: Record<string, string> = {
  "104": "Caixa Economica Federal",
  "323": "Mercado Pago",
  "336": "Banco C6 S.A.",
  "748": "Banco Cooperativo Sicredi S.A.",
};

function dateOfx(date: string) {
  return `${date.replace(/-/g, "")}120000[-3:BRT]`;
}

function ascii(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeOfx(value: string) {
  return ascii(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function transactionDate(transaction: StatementTransaction) {
  return transaction.accountingDate ?? transaction.date;
}

function transactionEntry(
  transaction: StatementTransaction,
  index: number,
) {
  const postedDate = transactionDate(transaction);
  const absoluteAmount = Math.abs(transaction.amount);
  const signedAmount =
    transaction.type === "CREDIT" ? absoluteAmount : -absoluteAmount;
  const reference = escapeOfx(transaction.document || String(index + 1));
  const fitId = escapeOfx(
    `${postedDate.replace(/-/g, "")}-${reference}-${index + 1}-${absoluteAmount.toFixed(2)}`,
  );

  return [
    "<STMTTRN>",
    `<TRNTYPE>${transaction.type === "CREDIT" ? "CREDIT" : "DEBIT"}</TRNTYPE>`,
    `<DTPOSTED>${dateOfx(postedDate)}</DTPOSTED>`,
    `<TRNAMT>${signedAmount.toFixed(2)}</TRNAMT>`,
    `<FITID>${fitId}</FITID>`,
    `<CHECKNUM>${reference}</CHECKNUM>`,
    `<REFNUM>${reference}</REFNUM>`,
    `<MEMO>${escapeOfx(transaction.description)}</MEMO>`,
    "</STMTTRN>",
  ].join("\r\n");
}

export function generateOfx(args: GenerateOfxInput) {
  const transactions = args.transactions
    .filter((transaction) => transaction.selected)
    .sort((first, second) => {
      const byDate = transactionDate(first).localeCompare(transactionDate(second));
      return byDate || first.id - second.id;
    });
  const today = new Date().toISOString().slice(0, 10);
  const start = transactions[0] ? transactionDate(transactions[0]) : today;
  const lastTransaction = transactions.at(-1);
  const end = lastTransaction ? transactionDate(lastTransaction) : start;
  const institutionName = escapeOfx(
    args.institutionName || institutionNames[args.bankId] || "Instituicao Financeira",
  );
  const bankId = escapeOfx(args.bankId);
  const branch = escapeOfx(args.branch || "0001");
  const account = escapeOfx(args.account || "000000000");
  const entries = transactions.map(transactionEntry).join("\r\n");

  // OFX Money 2000 v1.02. Mantemos todo o conteúdo em ASCII para que os
  // bytes gravados pelo navegador sejam compatíveis com USASCII/Windows-1252.
  return [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    "VERSION:102",
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
    "<OFX>",
    "<SIGNONMSGSRSV1>",
    "<SONRS>",
    "<STATUS>",
    "<CODE>0</CODE>",
    "<SEVERITY>INFO</SEVERITY>",
    "</STATUS>",
    `<DTSERVER>${dateOfx(end)}</DTSERVER>`,
    "<LANGUAGE>POR</LANGUAGE>",
    "<FI>",
    `<ORG>${institutionName}</ORG>`,
    `<FID>${bankId}</FID>`,
    "</FI>",
    "</SONRS>",
    "</SIGNONMSGSRSV1>",
    "<BANKMSGSRSV1>",
    "<STMTTRNRS>",
    "<TRNUID>1</TRNUID>",
    "<STATUS>",
    "<CODE>0</CODE>",
    "<SEVERITY>INFO</SEVERITY>",
    "</STATUS>",
    "<STMTRS>",
    "<CURDEF>BRL</CURDEF>",
    "<BANKACCTFROM>",
    `<BANKID>${bankId}</BANKID>`,
    `<BRANCHID>${branch}</BRANCHID>`,
    `<ACCTID>${account}</ACCTID>`,
    "<ACCTTYPE>CHECKING</ACCTTYPE>",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    `<DTSTART>${dateOfx(start)}</DTSTART>`,
    `<DTEND>${dateOfx(end)}</DTEND>`,
    entries,
    "</BANKTRANLIST>",
    "<LEDGERBAL>",
    `<BALAMT>${args.finalBalance.toFixed(2)}</BALAMT>`,
    `<DTASOF>${dateOfx(end)}</DTASOF>`,
    "</LEDGERBAL>",
    "</STMTRS>",
    "</STMTTRNRS>",
    "</BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\r\n");
}
