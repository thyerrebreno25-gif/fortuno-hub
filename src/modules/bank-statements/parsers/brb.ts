import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const months = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const datePattern = /^\d{1,2}\/\d{2}(?:\/\d{4})?$/;
function isoDate(text: string, year: number) {
  const [day, month, explicitYear] = text.split("/");
  const result = `${explicitYear || year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(result + "T12:00:00Z");
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== result) throw new Error("Data inválida no extrato BRB.");
  return result;
}
function money(text: string, requireSign = false) {
  const value = text.replace(/[\u2212\u2010-\u2015]/g, "-").replace(/\s/g, "");
  const match = value.match(/^R\$([+-]?)(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!match || requireSign && !match[1]) throw new Error("Valor ou sinal de entrada/saída não reconhecido no extrato BRB. Confira o PDF original.");
  const absolute = Number(match[2].replace(/\./g, "")) * 100 + Number(match[3]);
  if (!Number.isSafeInteger(absolute)) throw new Error("Valor fora do limite permitido no extrato BRB.");
  return {cents: match[1] === "-" ? -absolute : absolute, type: match[1] === "-" ? "DEBIT" as const : "CREDIT" as const};
}

/** The BRB's displayed number may repeat the three-digit branch before the
 * seven-digit account, including its check digit. Keep the PDF number on screen
 * and export branch/account separately, retaining leading zeroes.
 * Source: novo.brb.com.br/servico-de-informacao-ao-cidadao/perguntas-frequentes/ */
export function brbOfxAccount(account: string, branch: string) {
  let digits = account.replace(/\D/g, "");
  const agency = branch.replace(/\D/g, "").padStart(3, "0");
  if (digits.length === 10 && digits.startsWith(agency)) digits = digits.slice(3);
  if (agency.length !== 3 || digits.length !== 7) throw new Error("Confira a agência e a conta BRB antes de gerar o OFX.");
  return digits;
}

export function parseBrbStatement(input: PdfTextLine[]): ParsedStatement {
  const lines = [...input].sort((a, b) => a.page - b.page || b.y - a.y);
  const title = lines.findIndex(line => normalize(line.text) === "EXTRATO");
  const accounts = lines.flatMap(line => {const match = line.text.match(/Ag[eê]ncia:\s*(\d{1,3})\s*[—–-]\s*Conta Corrente:\s*([\d.\-/]+)/i); return match ? [match] : [];});
  const account = accounts[0];
  const periods = lines.flatMap(line => {const match = normalize(line.text).match(/^([A-Z]+)\s*\/\s*(\d{4})$/); return match && months.includes(match[1]) ? [match] : [];});
  if (title < 0 || !account || !periods.length) throw new Error("Layout BRB não reconhecido. Envie o PDF mensal com agência, conta e as colunas Dia, Histórico e Valor.");
  if (new Set(periods.map(item => item[1] + "/" + item[2])).size !== 1) throw new Error("Envie uma competência por arquivo para converter o extrato BRB.");
  if (new Set(accounts.map(item => item[1].padStart(3, "0") + ":" + item[2].replace(/\D/g, ""))).size !== 1) throw new Error("O PDF contém contas BRB diferentes. Envie uma conta por arquivo.");
  brbOfxAccount(account[2], account[1]);
  const month = months.indexOf(periods[0][1]) + 1, year = Number(periods[0][2]);
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const emitted = lines.find(line => /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(line.text.trim()));
  const reportedBalanceDate = emitted ? isoDate(emitted.text.split(/\s/)[0], year) : undefined;
  const raw: Array<{date: string; description: string; document: string; cents: number; type: "CREDIT" | "DEBIT"; order: number}> = [];
  const accountBalances = lines.filter(line => /^SALDO CONTA CORRENTE\b/.test(normalize(line.text)));
  if (!accountBalances.length) throw new Error("O saldo da conta corrente não foi encontrado no extrato BRB.");
  const reported = accountBalances.map(line => {
    const value = line.text.match(/R\$.*$/i)?.[0];
    if (!value) throw new Error("Saldo da conta corrente ilegível no extrato BRB.");
    return money(value).cents;
  });
  if (new Set(reported).size !== 1) throw new Error("O PDF BRB contém saldos de conta corrente diferentes. Confira os arquivos selecionados.");
  const pageSignatures = new Set<string>();
  for (const page of [...new Set(lines.map(line => line.page))]) {
    const pageLines = lines.filter(line => line.page === page);
    const header = pageLines.find(line => normalize(line.text) === "DIA HISTORICO VALOR");
    if (!header) {
      if (pageLines.some(line => /\bDOC\s*:\s*\d+/i.test(line.text) || line.parts.some(part => part.x < 55 && datePattern.test(part.text.trim())))) throw new Error(`As colunas das movimentações não foram reconhecidas na página ${page} do BRB.`);
      continue;
    }
    const historyX = header.parts.find(part => normalize(part.text) === "HISTORICO")?.x;
    const amountX = header.parts.find(part => normalize(part.text) === "VALOR")?.x;
    if (historyX === undefined || amountX === undefined || amountX <= historyX) throw new Error("As colunas do extrato BRB não foram identificadas.");
    const amountBoundary = historyX + (amountX - historyX) * .8;
    const footer = pageLines.find(line => line.y < header.y && normalize(line.text) === "SALDO ATUAL");
    const body = pageLines.filter(line => line.y < header.y && (!footer || line.y > footer.y));
    const anchors = body.flatMap(line => line.parts.filter(part => part.x < historyX - 5 && datePattern.test(part.text.trim())).map(part => ({y: line.y, date: isoDate(part.text.trim(), year)})));
    if (!anchors.length && body.some(line => /R\$|\bDOC\s*:/i.test(line.text))) throw new Error("Movimentação BRB sem data. A leitura ficou incompleta.");
    if (new Set(anchors.map(item => item.y)).size !== anchors.length) throw new Error("Datas sobrepostas no extrato BRB. Confira o PDF original.");
    const cells = anchors.map(() => [] as Array<{x: number; y: number; text: string}>);
    for (const line of body) {
      if (/^PAGINA\s+\d+/i.test(normalize(line.text))) continue;
      for (const part of line.parts) {
        if (!anchors.length) continue;
        if (part.x < historyX - 5) {
          if (!datePattern.test(part.text.trim())) throw new Error("Data de movimentação não reconhecida no extrato BRB.");
          continue;
        }
        // Browser PDFs vertically center the date/value beside a two-line
        // history. A description can appear above OR below its date baseline.
        const distances = anchors.map(anchor => Math.abs(anchor.y - line.y));
        const closest = distances.indexOf(Math.min(...distances));
        cells[closest].push({...part, y: line.y});
      }
    }
    const firstIndex = raw.length;
    anchors.forEach((anchor, index) => {
      if (anchor.date < periodStart || anchor.date > periodEnd) throw new Error("Movimentação BRB fora da competência informada no PDF.");
      const ordered = cells[index].sort((a, b) => b.y - a.y || a.x - b.x);
      const value = ordered.filter(part => part.x >= amountBoundary).map(part => part.text).join(" ");
      const history = ordered.filter(part => part.x < amountBoundary).map(part => part.text).join(" ").replace(/\s+/g, " ").trim();
      const documents = [...history.matchAll(/\bDOC\s*:\s*(\d+)\b/gi)];
      const document = documents.length === 1 ? documents[0][1] : undefined;
      const description = history.replace(/\s*[–—-]?\s*DOC\s*:\s*\d+\b/i, " ").replace(/\s+/g, " ").trim();
      if (!document || description.length < 3) throw new Error("Histórico ou documento incompleto em uma movimentação BRB.");
      const parsed = money(value, true);
      raw.push({date: anchor.date, description, document, ...parsed, order: raw.length});
    });
    if (raw.length > firstIndex) {
      const signature = JSON.stringify(raw.slice(firstIndex).map(({date, description, document, cents}) => ({date, description, document, cents})));
      if (pageSignatures.has(signature)) throw new Error("O extrato BRB contém uma página de movimentações repetida. Remova a página duplicada antes de converter.");
      pageSignatures.add(signature);
    }
  }
  if (!raw.length) throw new Error("Nenhuma movimentação foi encontrada no extrato BRB.");
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const net = raw.reduce((total, row) => total + row.cents, 0);
  const opening = reported[0] - net;
  if (!Number.isSafeInteger(opening)) throw new Error("Saldo calculado fora do limite permitido no extrato BRB.");
  const transactions: StatementTransaction[] = raw.map((row, index) => ({id: index + 1, selected: true, date: row.date, description: row.description, document: row.document, sourceType: row.description.split(/\s+\d/)[0], type: row.type, amount: Math.abs(row.cents) / 100, balance: null, status: "OK"}));
  return {bank: "BRB", layout: "Conta corrente mensal", branch: account[1].padStart(3, "0"), account: account[2], accountHolder: lines[title + 1]?.text, periodStart, periodEnd, detectedOpeningBalance: opening / 100, detectedClosingBalance: reported[0] / 100, openingBalanceCalculated: true, reportedBalanceDate, balanceWarnings: [`O saldo inicial foi calculado: saldo atual + saídas − entradas. O PDF informa saldo atual${reportedBalanceDate ? ` em ${reportedBalanceDate.split("-").reverse().join("/")}` : ""}, não um saldo anterior independente. Confira se esse saldo corresponde ao fechamento de ${periodEnd.split("-").reverse().join("/")}.`], transactions};
}
