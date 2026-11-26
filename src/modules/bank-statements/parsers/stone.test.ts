import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/stone-conta-corrente.json";
import { parseStoneStatement } from "./stone";
import { generateOfx } from "../ofx";
import type { PdfTextLine } from "../pdf-reader.client";
const source = () => structuredClone(fixture) as PdfTextLine[];
const replace = (rows: PdfTextLine[], from: string, to: string) => rows.map(l => { const parts = l.text === from ? [{ ...l.parts[0], text: to }] : l.parts.map(p => ({ ...p, text: p.text.replaceAll(from, to) })); return { ...l, parts, text: parts.map(p => p.text).join(" ") }; });
const header = () => source().filter(l => l.y >= 592);
const line = (y: number, date: string, type: string, amount: string, balance: string, description = "Transferência") => ({ page: 1, y, parts: [{ x: 26, text: date }, { x: 73, text: type }, { x: 119, text: description }, { x: 294, text: amount }, { x: 361, text: balance }, { x: 428, text: "Banco da contraparte" }], text: `${date} ${type} ${description} ${amount} ${balance}` });
describe("extrato de conta corrente Stone", () => {
    it("reads all gross receipts and fees separately and checks repeated net settlement balances", () => {
        const result = parseStoneStatement(source());
        expect(result).toMatchObject({ bank: "Stone", branch: "0001", account: "12345678-9", accountHolder: "EMPRESA EXEMPLO LTDA", periodStart: "2026-11-11", periodEnd: "2026-11-12", detectedOpeningBalance: 0, detectedClosingBalance: 3014.46, openingBalanceCalculated: true });
        expect(result.transactions.map(r => [r.type, r.amount])).toEqual([["CREDIT", 514.8], ["DEBIT", 2.57], ["CREDIT", 514.8], ["DEBIT", 2.57], ["CREDIT", 2000], ["DEBIT", 10]]);
        expect(result.transactions[0].description).toContain("CLIENTE UM Pix | Maquininha");
        expect(result.transactions[4].description).toContain("CLIENTE TRES EXEMPLO Pix | Maquininha");
        expect(result.transactions[5].description).toContain("PICPAY INSTITUIçãO DE PAGAMENTO S.A.");
        expect(result.transactions.map(r => r.balance)).toEqual([512.23, 512.23, 1024.46, 1024.46, 3014.46, 3014.46]);
        expect(result.transactions.every(r => r.status === "OK")).toBe(true);
    });
    it("generates a Stone OFX with the original period, signs and account, without inventing bank references", () => {
        const result = parseStoneStatement(source()), ofx = generateOfx({ bankId: "197", branch: result.branch, account: result.account, initialBalance: result.detectedOpeningBalance!, finalBalance: result.detectedClosingBalance!, periodStart: result.periodStart, periodEnd: result.periodEnd, transactions: result.transactions });
        expect(ofx).toContain("<ORG>Stone Instituicao de Pagamento S.A.</ORG>");
        expect(ofx).toContain("<BANKID>197</BANKID>");
        expect(ofx).toContain("<ACCTID>12345678-9</ACCTID>");
        expect(ofx).toContain("<DTSTART>20261111120000[-3:BRT]</DTSTART>");
        expect(ofx).toContain("<DTEND>20261112120000[-3:BRT]</DTEND>");
        expect(ofx).toContain("<BALAMT>3014.46</BALAMT>");
        expect(ofx.match(/<STMTTRN>/g)).toHaveLength(6);
        expect(ofx.match(/<TRNAMT>514.80<\/TRNAMT>/g)).toHaveLength(2);
        expect(ofx.match(/<TRNAMT>-2.57<\/TRNAMT>/g)).toHaveLength(2);
        expect(ofx).not.toContain("<CHECKNUM>");
        expect(ofx).not.toContain("COMPROVANTE-EXEMPLO");
    });
    it("uses stable unique FITIDs across repeat processing and overlapping periods", () => {
        const first = parseStoneStatement(source()).transactions.map(r => r.fitId), repeat = parseStoneStatement(source()).transactions.map(r => r.fitId), overlap = parseStoneStatement(replace(source(), "de 11/11/2026", "de 12/11/2026")).transactions.map(r => r.fitId);
        expect(new Set(first).size).toBe(6);
        expect(repeat).toEqual(first);
        expect(overlap).toEqual(first);
    });
    it("preserves genuinely repeated transactions rather than deduplicating them by date and amount", () => {
        const rows = [...header(), line(560, "12/11/26", "Saída", "- R$ 100,00", "R$ 0,00", "Transferência enviada"), line(520, "12/11/26", "Entrada", "R$ 100,00", "R$ 0,00", "Transferência recebida"), line(480, "12/11/26", "Saída", "- R$ 100,00", "R$ 0,00", "Transferência enviada"), line(440, "12/11/26", "Entrada", "R$ 100,00", "R$ 0,00", "Transferência recebida")];
        const result = parseStoneStatement(rows);
        expect(result.transactions).toHaveLength(4);
        expect(new Set(result.transactions.map(r => r.fitId)).size).toBe(4);
    });
    it("rejects altered fees and missing intermediate movements instead of manufacturing a closing balance", () => {
        expect(() => parseStoneStatement(replace(source(), "2,57", "2,50"))).toThrow("saldos intermediários");
        expect(() => parseStoneStatement(source().filter(l => l.y > 500 || l.y < 440))).toThrow("saldos intermediários");
    });
    it("rejects unrecognized amounts, mismatched signs, missing types and dates outside the declared period", () => {
        expect(() => parseStoneStatement(replace(source(), "R$ 2.000,00", "- R$ 2.000,00"))).toThrow("sinal");
        expect(() => parseStoneStatement(replace(source(), "- R$ 10,00", "ilegível"))).toThrow("Valor ou saldo");
        expect(() => parseStoneStatement(replace(source(), "Saída", "Outro"))).toThrow("Tipo");
        expect(() => parseStoneStatement(replace(source(), "12/11/26", "13/11/26"))).toThrow("fora do período");
        expect(() => parseStoneStatement(replace(source(), "12/11/26", "31/02/26"))).toThrow("Data inválida");
    });
    it("supports continued table pages while refusing repeated, missing or mixed-account pages", () => {
        const rows = source(), first = replace(rows.filter(l => l.y >= 592 || l.y >= 510 && l.y <= 572 || l.y < 370), "Página 1 de 1", "Página 1 de 2"), second = replace(rows.filter(l => l.y >= 592 || l.y >= 390 && l.y <= 490 || l.y < 370), "Página 1 de 1", "Página 2 de 2").map(l => ({ ...l, page: 2 }));
        expect(parseStoneStatement([...first, ...second]).transactions).toHaveLength(6);
        expect(() => parseStoneStatement(first)).toThrow("incompleto");
        const duplicate = replace(source(), "Página 1 de 1", "Página 1 de 2"), copy = replace(source(), "Página 1 de 1", "Página 2 de 2").map(l => ({ ...l, page: 2 }));
        expect(() => parseStoneStatement([...duplicate, ...copy])).toThrow("repetida");
        expect(() => parseStoneStatement([...first, ...replace(second, "12345678-9", "99999999-0")])).toThrow("única conta");
    });
    it("handles explicitly ascending dates, individual running balances and negative closing balances", () => {
        const ascending = parseStoneStatement([...header(), line(560, "11/11/26", "Entrada", "R$ 10,00", "R$ 110,00"), line(520, "12/11/26", "Entrada", "R$ 20,00", "R$ 130,00")]);
        expect(ascending).toMatchObject({ detectedOpeningBalance: 100, detectedClosingBalance: 130 });
        const negative = parseStoneStatement([...header(), line(560, "12/11/26", "Saída", "- R$ 20,00", "- R$ 10,00"), line(520, "11/11/26", "Entrada", "R$ 10,00", "R$ 10,00")]);
        expect(negative).toMatchObject({ detectedOpeningBalance: 0, detectedClosingBalance: -10 });
    });
    it("rejects another bank and an unreadable statement before creating any movements", () => {
        expect(() => parseStoneStatement(replace(source(), "Stone Instituição de Pagamento S.A.", "Outra Instituição"))).toThrow("Layout Stone");
        expect(() => parseStoneStatement(source().filter(l => l.y >= 592))).toThrow("Nenhuma movimentação");
    });
});
// Optional local QA reads the supplied file; the private PDF is never a test fixture.
it.skipIf(!process.env.FORTUNO_STONE_PDF)("converts and checks the user-supplied Stone PDF using the Hub reader", async () => {
    const fs = await import("node:fs/promises"), { extractPdfTextLines } = await import("../pdf-reader.client");
    const bytes = await fs.readFile(process.env.FORTUNO_STONE_PDF!), file = new File([new Uint8Array(bytes)], "extrato-stone.pdf", { type: "application/pdf" }), result = parseStoneStatement(await extractPdfTextLines(file));
    expect(result.transactions).toHaveLength(6);
    expect(result.detectedOpeningBalance).toBe(0);
    expect(result.detectedClosingBalance).toBe(3014.46);
    const credits = result.transactions.filter(r => r.type === "CREDIT").reduce((n, r) => n + Math.round(r.amount * 100), 0), debits = result.transactions.filter(r => r.type === "DEBIT").reduce((n, r) => n + Math.round(r.amount * 100), 0);
    expect(credits).toBe(302960);
    expect(debits).toBe(1514);
    const ofx = generateOfx({ bankId: "197", branch: result.branch, account: result.account, initialBalance: result.detectedOpeningBalance!, finalBalance: result.detectedClosingBalance!, periodStart: result.periodStart, periodEnd: result.periodEnd, transactions: result.transactions });
    expect(ofx.match(/<FITID>[^<]+<\/FITID>/g)).toHaveLength(6);
    expect(new Set(ofx.match(/<FITID>[^<]+<\/FITID>/g)).size).toBe(6);
    if (process.env.FORTUNO_STONE_OUTPUT) {
        await fs.mkdir(process.env.FORTUNO_STONE_OUTPUT, { recursive: true });
        await fs.writeFile(process.env.FORTUNO_STONE_OUTPUT + "/stone_2026-11-11_2026-11-12.ofx", ofx, "ascii");
        await fs.writeFile(process.env.FORTUNO_STONE_OUTPUT + "/conferencia-stone.json", JSON.stringify({ periodStart: result.periodStart, periodEnd: result.periodEnd, opening: result.detectedOpeningBalance, closing: result.detectedClosingBalance, credits: credits / 100, debits: debits / 100, count: result.transactions.length, transactions: result.transactions }, null, 2));
    }
});
