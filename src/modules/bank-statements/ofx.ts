import type { StatementTransaction } from "./types";

function dateOfx(date: string) { return date.replace(/-/g, "") + "120000[-3:BRT]"; }
function esc(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
export function generateOfx(args: { bankId: string; branch?: string; account?: string; initialBalance: number; finalBalance: number; transactions: StatementTransaction[] }) {
  const txs = args.transactions.filter((t) => t.selected);
  const postedDate = (transaction: StatementTransaction) => transaction.accountingDate ?? transaction.date;
  const start = txs[0] ? postedDate(txs[0]) : new Date().toISOString().slice(0, 10);
  const lastTransaction = txs.at(-1);
  const end = lastTransaction ? postedDate(lastTransaction) : start;
  const entries = txs.map((t, index) => `<STMTTRN><TRNTYPE>${t.type === "CREDIT" ? "CREDIT" : "DEBIT"}<DTPOSTED>${dateOfx(postedDate(t))}<TRNAMT>${t.type === "CREDIT" ? "" : "-"}${t.amount.toFixed(2)}<FITID>${postedDate(t).replace(/-/g, "")}-${index + 1}-${t.amount.toFixed(2)}<CHECKNUM>${esc(t.document || String(index + 1))}<MEMO>${esc(t.description)}</STMTTRN>`).join("\n");
  return `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:UTF-8\nCHARSET:NONE\nCOMPRESSION:NONE\nOLDFILEUID:NONE\nNEWFILEUID:NONE\n\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>${dateOfx(end)}<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1><BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>${esc(args.bankId)}<BRANCHID>${esc(args.branch || "")}<ACCTID>${esc(args.account || "")}<ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST><DTSTART>${dateOfx(start)}<DTEND>${dateOfx(end)}\n${entries}\n</BANKTRANLIST><LEDGERBAL><BALAMT>${args.finalBalance.toFixed(2)}<DTASOF>${dateOfx(end)}</LEDGERBAL><AVAILCASH>${args.initialBalance.toFixed(2)}</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
}
