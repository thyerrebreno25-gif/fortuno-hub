import { describe, expect, it } from "vitest";
import type { PdfTextLine } from "../pdf-reader.client";
import { generateOfx } from "../ofx";
import { brbOfxAccount, parseBrbStatement } from "./brb";

// Synthetic data reproduces the bank's vertical layout, not customer data.
const line = (y: number, parts: Array<[number, string]>, page = 1): PdfTextLine => ({page, y, text: parts.map(([, text]) => text).join(" "), parts: parts.map(([x, text]) => ({x, text}))});
function fixture() {
  const result = [line(732, [[270, "Extrato"]]), line(714, [[190, "EMPRESA EXEMPLO LTDA"]]), line(690, [[190, "Agência: 123 — Conta Corrente: 123.456.789-0"]]), line(666, [[260, "13/11/2026 18:27"]]), line(652, [[0, "OUTUBRO/2026"]]), line(628, [[9, "Dia"], [70, "Histórico"], [566, "Valor"]])];
  result.push(line(606, [[70, "DEBITO PIX – DOC: 000000"]]), line(600, [[9, "20/10"], [523, "R$"], [536, "−"], [541, "100,00"]]), line(594, [[70, "0001"]]));
  result.push(line(572, [[70, "RESG FI BRB FEDERAL INVEST – DOC: 123456"]]), line(568, [[9, "20/10"], [515, "R$ +1.500,00"]]), line(562, [[70, "00000000000000000000"]]));
  result.push(line(540, [[9, "20/10"], [70, "APLICACAO CDB/RDB – DOC: 000000"], [520, "R$ − 1.000,00"]]));
  for (const [y, day, name] of [[514, "06/10", "UM"], [480, "06/10", "DOIS"], [426, "05/10", "TRES"], [394, "05/10", "QUATRO"], [338, "02/10", "CINCO"], [306, "02/10", "SEIS"], [240, "01/10", "SETE"], [208, "01/10", "OITO"], [174, "01/10", "NOVE"]] as const) {
    result.push(line(y + 4, [[70, "DEBITO TRANSF ELETR ENTRE C/C – DOC: 234567"]]), line(y, [[9, day], [523, "R$ − 300,00"]]), line(y - 6, [[70, `EMPRESA ${name} — 1000000001`]]));
  }
  // This row's main history is below the date/value baseline.
  result.push(line(454, [[9, "06/10"], [523, "R$ +600,00"]]), line(452, [[70, "RESGATE CDB/RDB – DOC: 000000"]]));
  result.push(line(366, [[9, "05/10"], [70, "RESGATE CDB/RDB – DOC: 000000"], [523, "R$ +600,00"]]));
  result.push(line(278, [[70, "APL FI BRB FEDERAL INVEST – DOC: 123457"]]), line(274, [[9, "02/10"], [520, "R$ − 1.200,00"]]), line(268, [[70, "00000000000000000000"]]));
  result.push(line(116, [[9, "SALDO ATUAL"]]), line(94, [[9, "Saldo Conta Corrente"], [533, "R$ +35,19"]]), line(72, [[9, "Saldo da Poupança / CDB Automático / Fundo Automático (+)"], [533, "R$ +99,99"]]), line(52, [[9, "Saldo Atual (=)"], [533, "R$ +135,18"]]));
  return result.sort((a, b) => b.y - a.y);
}
describe("extrato mensal BRB", () => {
  it("reads every signed movement, preserves complements and derives opening = current + debits - credits", () => {
    const parsed = parseBrbStatement(fixture());
    expect(parsed).toMatchObject({bank: "BRB", branch: "123", account: "123.456.789-0", accountHolder: "EMPRESA EXEMPLO LTDA", periodStart: "2026-10-01", periodEnd: "2026-10-31", detectedOpeningBalance: 2335.19, detectedClosingBalance: 35.19, openingBalanceCalculated: true, reportedBalanceDate: "2026-11-13"});
    expect(parsed.transactions).toHaveLength(15);
    expect(parsed.transactions.filter(row => row.type === "CREDIT")).toHaveLength(3);
    expect(parsed.transactions.filter(row => row.type === "DEBIT")).toHaveLength(12);
    expect(parsed.transactions[0]).toMatchObject({date: "2026-10-01", document: "234567", description: expect.stringContaining("EMPRESA SETE")});
    expect(parsed.transactions.find(row => row.date === "2026-10-06" && row.type === "CREDIT")?.description).toBe("RESGATE CDB/RDB");
    expect(parsed.transactions.every(row => row.balance === null && row.selected && row.status === "OK")).toBe(true);
    expect(parsed.balanceWarnings?.join(" ")).toContain("calculado");
  });
  it("exports code 070, separates branch/account, keeps all duplicate document numbers and the full competence", () => {
    const parsed = parseBrbStatement(fixture());
    const ofx = generateOfx({bankId: "070", branch: parsed.branch, account: brbOfxAccount(parsed.account!, parsed.branch!), initialBalance: parsed.detectedOpeningBalance!, finalBalance: parsed.detectedClosingBalance!, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd, transactions: parsed.transactions});
    expect(ofx).toContain("<BANKID>070</BANKID>"); expect(ofx).toContain("<BRANCHID>123</BRANCHID>"); expect(ofx).toContain("<ACCTID>4567890</ACCTID>");
    expect(ofx).toContain("<ORG>BRB - Banco de Brasilia S.A.</ORG>"); expect(ofx).toContain("<DTEND>20261031120000[-3:BRT]</DTEND>"); expect(ofx).toContain("<DTASOF>20261031120000[-3:BRT]</DTASOF>");
    expect(ofx.match(/<STMTTRN>/g)).toHaveLength(15); expect(new Set([...ofx.matchAll(/<FITID>(.*?)<\/FITID>/g)].map(item => item[1])).size).toBe(15);
    expect(ofx.match(/<TRNAMT>-300.00<\/TRNAMT>/g)).toHaveLength(9); expect(ofx).toContain("<BALAMT>35.19</BALAMT>");
  });
  it("keeps a leading zero in accounts with and without the repeated branch", () => {expect(brbOfxAccount("123.045.678-9", "123")).toBe("0456789"); expect(brbOfxAccount("045.678-9", "123")).toBe("0456789"); expect(() => brbOfxAccount("999.045.678-9", "123")).toThrow();});
  it("handles repeated headers on multiple pages without merging rows across pages", () => {
    const all = fixture(), first = all.filter(row => row.y >= 540), second = [all.find(row => row.y === 628)!, ...all.filter(row => row.y < 540)].map(row => ({...row, page: 2}));
    expect(parseBrbStatement([...first, ...second]).transactions).toHaveLength(15);
  });
  it.each(["missing value", "unsigned", "invalid date", "missing description"])("rejects incomplete or ambiguous movement: %s", condition => {
    let rows = fixture();
    if (condition === "missing value") rows = rows.map(row => row.y === 600 ? line(600, [[9, "20/10"]]) : row);
    if (condition === "unsigned") rows = rows.map(row => row.y === 600 ? line(600, [[9, "20/10"], [523, "R$ 100,00"]]) : row);
    if (condition === "invalid date") rows = rows.map(row => row.y === 600 ? line(600, [[9, "32/10"], [523, "R$ -100,00"]]) : row);
    if (condition === "missing description") rows = rows.filter(row => row.y !== 606);
    expect(() => parseBrbStatement(rows)).toThrow();
  });
  it("never counts the footer's investments/consolidated balance as movements", () => {const result = parseBrbStatement(fixture()); expect(result.detectedClosingBalance).toBe(35.19); expect(result.transactions.some(row => /SALDO|POUPANCA/.test(row.description))).toBe(false);});
  it("rejects repeated pages and PDFs that mix different accounts", () => {
    expect(() => parseBrbStatement([...fixture(), ...fixture().map(row => ({...row, page: 2}))])).toThrow("repetida");
    expect(() => parseBrbStatement([...fixture(), line(690, [[190, "Agência: 999 — Conta Corrente: 999.456.789-0"]], 2)])).toThrow("contas BRB diferentes");
  });
  it("rejects an orphan transaction with no date instead of absorbing its history into another row", () => {
    expect(() => parseBrbStatement([...fixture(), line(584, [[70, "DEBITO PIX – DOC: 777777"]])])).toThrow();
    expect(() => parseBrbStatement([...fixture(), line(300, [[70, "DEBITO PIX – DOC: 777777"]], 2)])).toThrow("colunas");
  });
  it("supports zero or negative current balances without changing original movement amounts", () => {
    for (const [text, expected] of [["R$ 0,00", 0], ["R$ − 20,25", -20.25]] as const) {
      const rows = fixture().map(row => row.y === 94 ? line(94, [[9, "Saldo Conta Corrente"], [533, text]]) : row);
      const result = parseBrbStatement(rows); expect(result.detectedClosingBalance).toBe(expected); expect(result.detectedOpeningBalance).toBe(expected + 2300);
    }
  });
});
