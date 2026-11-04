import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedStatement, StatementTransaction } from "../types";

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const cents = (text: string) => {
  if (!/^-?\d{1,3}(?:\.\d{3})*,\d{2}$/.test(text)) throw new Error("Valor ilegível no extrato Safra. Confira o PDF original.");
  return Math.round(Number(text.replace(/\./g, "").replace(",", ".")) * 100);
};
function fullDate(text: string) {
  const [day, month, year] = text.split("/");
  const iso = year + "-" + month + "-" + day;
  if (new Date(iso + "T12:00:00Z").toISOString().slice(0,10) !== iso) throw new Error("Data inválida no extrato Safra.");
  return iso;
}

export function parseSafraStatement(lines: PdfTextLine[]): ParsedStatement {
  const joined = normalize(lines.map(line => line.text).join("\n"));
  if (!joined.includes("BANCO SAFRA") || !joined.includes("EXTRATO DE CONTA CORRENTE")) throw new Error("O arquivo não corresponde ao extrato de conta corrente Safra configurado.");
  const period = joined.match(/PERIODO DE (\d{2}\/\d{2}\/\d{4}) A (\d{2}\/\d{2}\/\d{4})/);
  const account = joined.match(/AG:\s*(\d+)\s*\|\s*CONTA:\s*([\d-]+)/);
  if (!period || !account) throw new Error("Não foi possível identificar o período, a agência e a conta Safra.");
  const periodStart = fullDate(period[1]), periodEnd = fullDate(period[2]);
  if (periodStart > periodEnd) throw new Error("Período inválido no extrato Safra.");
  function date(text: string) {
    const candidates: string[] = [];
    for (let year = Number(periodStart.slice(0,4)); year <= Number(periodEnd.slice(0,4)); year++) {
      const candidate = fullDate(text + "/" + year);
      if (candidate >= periodStart && candidate <= periodEnd) candidates.push(candidate);
    }
    if (candidates.length !== 1) throw new Error("Data fora do período ou ambígua no extrato Safra: " + text);
    return candidates[0];
  }
  const transactions: StatementTransaction[] = [];
  const balanceWarnings: string[] = [];
  let columns: {date: number; launch: number; complement: number; document: number; amount: number} | null = null;
  let inTable = false, pending = 0, opening: number | undefined, closing: number | undefined;
  let previousDate = "", lastWasTransaction = false;
  for (const line of lines) {
    const key = normalize(line.text);
    if (key.startsWith("DATA LANCAMENTO COMPLEMENTO") && key.includes("DOCUMENTO") && key.includes("VALOR")) {
      const parts = line.parts;
      const find = (prefix: string) => parts.find(part => normalize(part.text).startsWith(prefix))?.x;
      const d = find("DATA"), launch = find("LANCAMENTO"), complement = find("COMPLEMENTO"), document = parts.find(part => normalize(part.text).includes("DOCUMENTO"))?.x, amount = find("VALOR");
      if ([d,launch,complement,document,amount].some(value => value === undefined)) throw new Error("As colunas do extrato Safra não foram identificadas.");
      columns = {date:d!,launch:launch!,complement:complement!,document:document!,amount:(document!+amount!)/2};
      inTable = true;
      continue;
    }
    if (/^(CENTRAL DE SUPORTE|BANCO SAFRA|PAGINA|LANCAMENTOS REALIZADOS)/.test(key)) {inTable=false;continue;}
    if (!inTable || !columns) continue;
    const col = columns;
    const cell = (min: number, max: number) => line.parts.filter(part => part.x >= min - 2 && part.x < max - 2).map(part => part.text).join(" ").trim();
    const rawDate = cell(col.date, col.launch);
    if (!/^\d{2}\/\d{2}$/.test(rawDate)) {
      // Complements (including CPF/CNPJ) can wrap onto the following line.
      if (lastWasTransaction && line.parts.every(part => part.x >= col.complement - 2 && part.x < col.document - 2)) {
        transactions.at(-1)!.description += " " + line.text.trim();
      } else if (/^\d{2}\//.test(rawDate)) throw new Error("Linha de movimentação Safra não reconhecida.");
      else if (line.parts.some(part => part.x >= col.amount)) throw new Error("Linha com valor sem data no extrato Safra.");
      continue;
    }
    const iso = date(rawDate);
    if (iso < previousDate) throw new Error("As movimentações Safra estão fora de ordem cronológica.");
    previousDate = iso;
    const launch = cell(col.launch, col.complement);
    const description = cell(col.launch, col.document);
    const rawAmount = cell(col.amount, Infinity);
    const value = cents(rawAmount);
    if (/^SALDO (TOTAL|INICIAL|ANTERIOR)$/.test(normalize(launch))) {
      if (opening === undefined) {opening = value - pending;closing = value;}
      else {
        const expected = closing! + pending;
        if (expected !== value) balanceWarnings.push("Saldo de " + rawDate + ": calculado R$ " + (expected/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}) + ", informado R$ " + (value/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}) + ". Diferença de R$ " + (Math.abs(value-expected)/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}) + " no extrato original.");
        closing = value;
      }
      const last = transactions.at(-1);
      if (last?.date === iso && pending !== 0 && normalize(launch) === "SALDO TOTAL") last.balance = value/100;
      pending = 0;
      lastWasTransaction = false;
      continue;
    }
    if (!launch || !description) throw new Error("Descrição ausente na movimentação Safra.");
    transactions.push({id:transactions.length+1,selected:true,date:iso,description,document:cell(col.document,col.amount),sourceType:launch,type:value<0?"DEBIT":"CREDIT",amount:Math.abs(value)/100,balance:null,status:"OK"});
    pending += value;
    lastWasTransaction = true;
  }
  if (!transactions.length || opening === undefined || closing === undefined || lastWasTransaction) throw new Error("Não foi possível confirmar todas as movimentações e o saldo final Safra.");
  const title = lines.findIndex(line => normalize(line.text) === "EXTRATO DE CONTA CORRENTE");
  const holder = title > 0 ? lines[title-1].text.trim() : undefined;
  return {bank:"Safra",layout:"Conta corrente PJ",accountHolder:holder,branch:account[1],account:account[2],periodStart,periodEnd,detectedOpeningBalance:opening/100,detectedClosingBalance:closing/100,balanceWarnings,transactions};
}
