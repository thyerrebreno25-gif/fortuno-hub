import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const datePattern = /^\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})$/;
const labels = ["DATA", "TIPO", "DESCRICAO", "VALOR", "SALDO", "CONTRAPARTE"];
type Raw = {
    date: string;
    type: "CREDIT" | "DEBIT";
    amount: number;
    balance: number;
    description: string;
    counterparty: string;
    page: number;
};
function iso(day: number, month: number, year: number) { const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, parsed = new Date(result + "T12:00:00Z"); if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== result)
    throw new Error("Data inválida no extrato Stone."); return result; }
function fullDate(value: string) { const [day, month, year] = value.split("/").map(Number); return iso(day, month, year); }
function rowDate(value: string, start: string, end: string) { const [day, month, year] = value.split("/").map(Number); if (value.split("/")[2].length === 4) {
    const date = iso(day, month, year);
    if (date < start || date > end)
        throw new Error("Movimentação Stone fora do período informado.");
    return date;
} const years = []; for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++)
    if (y % 100 === year)
        years.push(y); const matches = years.map(y => iso(day, month, y)).filter(date => date >= start && date <= end); if (matches.length !== 1)
    throw new Error("Data de movimentação fora do período ou ambígua no extrato Stone."); return matches[0]; }
function cents(value: string) {
    const text = clean(value).replace(/[−–—]/g, "-"), match = text.match(/^([+-])?\s*(?:R\$\s*)?([+-])?\s*((?:\d{1,3}(?:\.\d{3})+|\d+)),(\d{2})$/);
    if (!match || match[1] && match[2])
        throw new Error("Valor ou saldo incompleto em uma movimentação Stone. Confira o PDF original.");
    const absolute = Number(match[3].replace(/\./g, "")) * 100 + Number(match[4]);
    if (!Number.isSafeInteger(absolute))
        throw new Error("Valor fora do limite permitido no extrato Stone.");
    return { value: (match[1] || match[2]) === "-" ? -absolute : absolute, sign: match[1] || match[2] || "" };
}
const columnText = (line: PdfTextLine, left: number, right = Infinity) => line.parts.filter(p => p.x >= left - 2 && p.x < right - 2).map(p => p.text).join(" ");
function tableColumns(line: PdfTextLine) { const values = labels.map(label => line.parts.find(p => normalized(p.text) === label)?.x); return values.every((x, i) => x !== undefined && (i === 0 || x > values[i - 1]!)) ? values as number[] : null; }
function metadata(lines: PdfTextLine[]) {
    const accounts: Array<{
        branch: string;
        account: string;
    }> = [], holders: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i], institution = line.parts.find(p => normalized(p.text) === "INSTITUICAO"), agency = line.parts.find(p => normalized(p.text) === "AGENCIA"), account = line.parts.find(p => normalized(p.text) === "CONTA");
        if (institution && agency && account) {
            const following = lines.slice(i + 1).filter(l => l.page === line.page && l.y < line.y && l.y >= line.y - 50);
            const value = following.find(l => normalized(columnText(l, institution.x, agency.x)).includes("STONE INSTITUICAO DE PAGAMENTO"));
            if (!value)
                throw new Error("A instituição da conta não foi reconhecida como Stone.");
            const branch = clean(columnText(value, agency.x, account.x)), number = clean(columnText(value, account.x));
            if (!/^\d{1,4}$/.test(branch) || !/^\d{3,20}(?:-\d{1,2})?$/.test(number))
                throw new Error("Agência ou conta incompleta no extrato Stone.");
            accounts.push({ branch: branch.padStart(4, "0"), account: number });
        }
        const name = line.parts.find(p => normalized(p.text) === "NOME"), document = line.parts.find(p => normalized(p.text) === "DOCUMENTO");
        if (name && document) {
            const parts: string[] = [];
            for (const next of lines.slice(i + 1)) {
                if (next.page !== line.page || next.y >= line.y)
                    continue;
                if (next.parts.some(p => normalized(p.text) === "INSTITUICAO") || line.y - next.y > 45)
                    break;
                const text = columnText(next, name.x, document.x);
                if (text)
                    parts.push(text);
            }
            if (parts.length)
                holders.push(clean(parts.join(" ")));
        }
    }
    if (!accounts.length || new Set(accounts.map(a => a.branch + ":" + a.account)).size !== 1 || new Set(holders.map(normalized)).size > 1)
        throw new Error("Envie um extrato Stone de uma única conta, com os dados da agência e da conta.");
    return { ...accounts[0], accountHolder: holders[0] };
}
// Stable across repeated exports and overlapping periods. This is an OFX ID,
// not an invented bank document number; repeated identical rows remain distinct.
function hash(value: string) { let first = 2166136261, second = 2246822519; for (let i = 0; i < value.length; i++) {
    first = Math.imul(first ^ value.charCodeAt(i), 16777619);
    second = Math.imul(second ^ value.charCodeAt(i), 3266489917);
} return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0"); }
export function parseStoneStatement(source: PdfTextLine[]): ParsedStatement {
    const lines = [...source].filter(l => l.text.trim()).sort((a, b) => a.page - b.page || b.y - a.y), joined = lines.map(l => l.text).join("\n");
    if (!normalized(joined).includes("EXTRATO DE CONTA CORRENTE") || !normalized(joined).includes("STONE INSTITUICAO DE PAGAMENTO"))
        throw new Error("Layout Stone não reconhecido. Envie o PDF original do extrato de conta corrente.");
    const periods = [...joined.matchAll(/Per[ií]odo:\s*de\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/gi)];
    if (!periods.length || new Set(periods.map(m => m[1] + ":" + m[2])).size !== 1)
        throw new Error("O período do extrato Stone não foi identificado ou contém períodos diferentes.");
    const periodStart = fullDate(periods[0][1]), periodEnd = fullDate(periods[0][2]);
    if (periodStart > periodEnd)
        throw new Error("Período inválido no extrato Stone.");
    const account = metadata(lines), pages = [...new Set(lines.map(l => l.page))], printed = lines.map(l => normalized(l.text).match(/^PAGINA (\d+) DE (\d+)$/)).filter((m): m is RegExpMatchArray => Boolean(m));
    if (printed.length && (printed.length !== pages.length || printed.some(m => Number(m[2]) !== pages.length) || new Set(printed.map(m => Number(m[1]))).size !== pages.length || printed.some(m => Number(m[1]) < 1 || Number(m[1]) > pages.length)))
        throw new Error("O PDF Stone está incompleto ou contém páginas repetidas. Envie o extrato completo.");
    const raw: Raw[] = [], signatures = new Set<string>();
    let previousColumns: number[] | null = null;
    for (const page of pages) {
        const pageLines = lines.filter(l => l.page === page), headers = pageLines.map((line, i) => ({ line, i, columns: tableColumns(line) })).filter(h => h.columns);
        if (headers.length > 1)
            throw new Error("Mais de uma tabela de movimentações na mesma página Stone. Confira o PDF original.");
        const header = headers[0];
        const columns: number[] | null = header?.columns || previousColumns;
        if (!columns) {
            if (pageLines.some(l => datePattern.test(clean(columnText(l, 0, 70)))))
                throw new Error("As colunas do extrato Stone não foram identificadas.");
            continue;
        }
        previousColumns = columns;
        const candidates = header ? pageLines.slice(header.i + 1) : pageLines, footer = candidates.findIndex(l => /^(INFORMACOES DO COMPROVANTE|OUVIDORIA|DUVIDAS\??)/.test(normalized(l.text))), body = footer < 0 ? candidates : candidates.slice(0, footer);
        const anchors = body.filter(l => datePattern.test(clean(columnText(l, columns[0], columns[1]))));
        if (!anchors.length) {
            if (body.some(l => /^(ENTRADA|SAIDA)$/.test(normalized(columnText(l, columns[1], columns[2]))) || /R\$/.test(columnText(l, columns[3], columns[5]))))
                throw new Error("Movimentação Stone sem data. A leitura ficou incompleta.");
            continue;
        }
        const cells = anchors.map(() => Array.from({ length: 6 }, () => [] as string[]));
        for (const line of body) {
            const nearest = anchors.reduce((best, anchor, i) => Math.abs(anchor.y - line.y) < Math.abs(anchors[best].y - line.y) ? i : best, 0);
            for (let c = 1; c < 6; c++) {
                const text = columnText(line, columns[c], columns[c + 1]);
                if (text)
                    cells[nearest][c].push(text);
            }
        }
        const pageRows: Raw[] = anchors.map((anchor, i) => {
            const type = normalized(cells[i][1].join(" "));
            if (!["ENTRADA", "SAIDA"].includes(type))
                throw new Error("Tipo de entrada/saída não reconhecido em uma movimentação Stone.");
            const amount = cents(cells[i][3].join(" ")), balance = cents(cells[i][4].join(" ")).value, description = clean(cells[i][2].join(" ")), counterparty = clean(cells[i][5].join(" "));
            if (type === "ENTRADA" && amount.value < 0 || type === "SAIDA" && amount.sign === "+")
                throw new Error("O sinal do valor diverge do tipo da movimentação Stone.");
            if (!description)
                throw new Error("Descrição incompleta em uma movimentação Stone.");
            return { date: rowDate(clean(columnText(anchor, columns[0], columns[1])), periodStart, periodEnd), type: type === "ENTRADA" ? "CREDIT" : "DEBIT", amount: Math.abs(amount.value), balance, description, counterparty, page };
        });
        const signature = JSON.stringify(pageRows.map(row => ({ ...row, page: undefined })));
        if (signatures.has(signature))
            throw new Error("O PDF Stone contém uma página de movimentações repetida.");
        signatures.add(signature);
        raw.push(...pageRows);
    }
    if (!raw.length)
        throw new Error("Nenhuma movimentação foi encontrada no extrato Stone.");
    const ascending = raw.every((r, i) => !i || r.date >= raw[i - 1].date), descending = raw.every((r, i) => !i || r.date <= raw[i - 1].date);
    if (!ascending && !descending)
        throw new Error("As datas do extrato Stone estão fora de ordem. Confira as páginas do PDF.");
    // The Stone layout is newest first, including same-day receipts and fees.
    const chronological = descending ? [...raw].reverse() : raw;
    const groups: Array<{
        date: string;
        balance: number;
        net: number;
    }> = [];
    for (const row of chronological) {
        let group = groups.at(-1);
        if (!group || group.date !== row.date || group.balance !== row.balance) {
            group = { date: row.date, balance: row.balance, net: 0 };
            groups.push(group);
        }
        group.net += row.type === "CREDIT" ? row.amount : -row.amount;
        if (!Number.isSafeInteger(group.net))
            throw new Error("Total de movimentações fora do limite permitido no extrato Stone.");
    }
    const opening = groups[0].balance - groups[0].net;
    if (!Number.isSafeInteger(opening))
        throw new Error("Saldo inicial fora do limite permitido no extrato Stone.");
    let running = opening;
    for (const group of groups) {
        running += group.net;
        if (!Number.isSafeInteger(running) || running !== group.balance)
            throw new Error(`Os saldos intermediários do extrato Stone não fecham em ${group.date.split("-").reverse().join("/")}. Confira se falta alguma movimentação ou página.`);
    }
    const occurrences = new Map<string, number>();
    const transactions: StatementTransaction[] = chronological.map((row, i) => { const key = normalized(JSON.stringify([account.branch, account.account, row.date, row.type, row.amount, row.balance, row.description, row.counterparty])), occurrence = (occurrences.get(key) || 0) + 1; occurrences.set(key, occurrence); return { id: i + 1, selected: true, date: row.date, description: row.description + (row.counterparty ? " | Contraparte: " + row.counterparty : ""), document: "", fitId: `STONE-${row.date.replace(/-/g, "")}-${hash(key)}-${occurrence}`, sourceType: row.type === "CREDIT" ? "Entrada" : "Saída", type: row.type, amount: row.amount / 100, balance: row.balance / 100, status: "OK" }; });
    return { bank: "Stone", layout: "Conta corrente", ...account, periodStart, periodEnd, detectedOpeningBalance: opening / 100, detectedClosingBalance: running / 100, openingBalanceCalculated: true, reportedBalanceDate: periodEnd, balanceWarnings: ["O saldo inicial foi calculado a partir do grupo de movimentações mais antigo. A Stone pode repetir o saldo líquido no recebimento e na tarifa; os valores foram mantidos separados e os saldos intermediários conferidos por grupo."], transactions };
}
