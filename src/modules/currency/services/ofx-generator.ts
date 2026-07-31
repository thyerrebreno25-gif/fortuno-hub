import type { CurrencyTransaction } from "../types";

function escapeOfx(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ofxDate(value: string): string {
  return `${value.replace(/-/g, "")}120000[-3:BRT]`;
}

export function generateCurrencyOfx(
  transactions: CurrencyTransaction[],
  options: {
    bankId: string;
    accountId: string;
    accountType: "CHECKING" | "SAVINGS";
  },
): string {
  const valid = transactions.filter(
    (transaction) =>
      transaction.status === "CONVERTED" &&
      transaction.convertedAmount !== null &&
      transaction.rate !== null,
  );

  if (valid.length === 0) {
    throw new Error("Não há movimentações convertidas para exportar.");
  }

  const ordered = [...valid].sort((a, b) => a.date.localeCompare(b.date));
  const start = ordered[0].date;
  const end = ordered[ordered.length - 1].date;

  const entries = ordered
    .map((transaction) => {
      const signedAmount =
        transaction.type === "DEBIT"
          ? -Math.abs(transaction.convertedAmount ?? 0)
          : Math.abs(transaction.convertedAmount ?? 0);

      const memo = `${transaction.description} | ${transaction.currency} ${transaction.originalAmount.toFixed(2)} | PTAX ${transaction.rate?.toFixed(8)} | cotação ${transaction.rateDate}`;

      return `<STMTTRN>
<TRNTYPE>${transaction.type === "DEBIT" ? "DEBIT" : "CREDIT"}
<DTPOSTED>${ofxDate(transaction.date)}
<TRNAMT>${signedAmount.toFixed(2)}
<FITID>CN-CAMBIO-${transaction.id}
<MEMO>${escapeOfx(memo)}
</STMTTRN>`;
    })
    .join("\n");

  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:UTF-8
CHARSET:UTF-8
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${ofxDate(end)}
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>CONVERTNOW-${Date.now()}
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>${escapeOfx(options.bankId || "000")}
<ACCTID>${escapeOfx(options.accountId || "CONVERTNOW")}
<ACCTTYPE>${options.accountType}
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${ofxDate(start)}
<DTEND>${ofxDate(end)}
${entries}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>0.00
<DTASOF>${ofxDate(end)}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;
}

export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
