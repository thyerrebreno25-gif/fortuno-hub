import { brDate, digits, moneyCents, normalize, type ContractReview, type InvestmentReview } from "./model";

export type DocumentLine = { text: string; page: number };
export function parseInvestment(lines: DocumentLine[]): InvestmentReview {
  const result: InvestmentReview = { kind: "INVESTMENT", periodStart: "", periodEnd: "", bankAccount: "", customerId: "", serviceId: "", rows: [], warnings: [] };
  let group = "";
  for (const line of lines) {
    const normalized = normalize(line.text);
    const period = normalized.match(/periodo de:\s*(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/);
    if (period) { result.periodStart = brDate(period[1]); result.periodEnd = brDate(period[2]); }
    const account = normalized.match(/conta:\s*([\d.-]+)/);
    if (account) result.bankAccount = account[1];
    if (/^cdb\b/.test(normalized)) group = line.text.trim();
    if (!normalized.includes("rendimento ate esta data")) continue;
    // The first currency value belongs to Valor. The second is Saldo and must never be summed.
    const match = line.text.match(/(\d{2}\/\d{2}\/\d{4})\s+Rendimento\s+at[eé]\s+esta\s+data\s+R\$\s*([\d.]+,\d{2})/i);
    if (!match || !group) { result.warnings.push(`Página ${line.page}: linha de rendimento sem tipo, data ou valor reconhecido.`); continue; }
    const date = brDate(match[1]);
    const key = normalize(group) + "|" + date;
    let row = result.rows.find((item) => item.key === key);
    if (!row) { row = { key, description: group, date, amountCents: 0, categoryId: "", accountId: "", evidence: [] }; result.rows.push(row); }
    const amountCents = moneyCents(match[2]);
    row.amountCents += amountCents;
    row.evidence.push({ page: line.page, text: line.text, amountCents });
  }
  if (!result.rows.length) result.warnings.push("Layout não reconhecido ou PDF sem texto. Revise o arquivo antes de continuar.");
  if (new Set(result.rows.map((row) => row.date)).size > 1) result.warnings.push("Há mais de uma data de apuração: os totais foram separados por tipo e data.");
  return result;
}

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function party(block: string) {
  const document = block.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/)?.[0] || "";
  const name = block.split(/,?\s*(?:pessoa juridica|inscrita|inscrito|cnpj|cpf)\b/i)[0].replace(/[,\s]+$/, "").trim();
  return { name: name.slice(0, 300), document };
}
export function parseContract(lines: DocumentLine[]): ContractReview {
  const original = lines.map((line) => line.text).join(" ").replace(/\s+/g, " ");
  const all = normalize(original);
  const buyerBlock = all.match(/contratante\s*:\s*(.*?)(?=contratada\s*:)/)?.[1] || "";
  const sellerBlock = all.match(/contratada\s*:\s*(.*?)(?=as partes|clausula primeira)/)?.[1] || "";
  const buyer = party(buyerBlock); const seller = party(sellerBlock);
  const price = all.match(/valor\s+(?:total\s+)?de\s+r\$\s*([\d.]+,\d{2})/);
  const installments = all.match(/em\s+(\d{1,3})\s+parcelas\s+(?:mensais\s+)?de\s+r\$\s*([\d.]+,\d{2})/);
  const first = all.match(/(?:vencimento\s+(?:da\s+)?primeira|primeiro\s+vencimento)[\s\S]{0,100}?(\d{2}\/\d{2}\/\d{4})/);
  const originalDateMatch = all.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/);
  const originalDate = originalDateMatch ? `${originalDateMatch[3]}-${String(MONTHS.indexOf(originalDateMatch[2]) + 1).padStart(2, "0")}-${originalDateMatch[1].padStart(2, "0")}` : "";
  const firstDueDate = first ? brDate(first[1]) : "";
  const descriptionLine = lines.findIndex((line) => /contrato de presta[cç][aã]o de servi[cç]os/i.test(line.text));
  const next = descriptionLine >= 0 ? lines[descriptionLine + 1]?.text || "" : "";
  const description = /contratante|contratada|cnpj/i.test(next) ? "" : next.slice(0, 300);
  const warnings = ["Início das vendas sugerido pelo mês do primeiro vencimento. Confira a data na revisão.", "Boleto e nota fiscal automáticos devem ser configurados diretamente no Conta Azul."];
  if (!installments) warnings.push("Quantidade de cobranças e valor por venda não identificados. Preencha na revisão.");
  if (!buyer.document || !seller.document) warnings.push("Não foi possível identificar com segurança as duas partes do contrato.");
  if (installments && !/meses subsequentes|parcelas mensais|mensal/.test(all)) warnings.push("Periodicidade mensal sugerida: confirme no documento.");
  return { kind: "CONTRACT", buyer: buyer.name.toUpperCase(), buyerDocument: digits(buyer.document), seller: seller.name.toUpperCase(), sellerDocument: digits(seller.document), description,
    originalDate, firstDueDate, startMonth: firstDueDate ? firstDueDate.slice(0, 7) + "-01" : "", installments: Number(installments?.[1] || 0), amountCents: installments ? moneyCents(installments[2]) : 0,
    totalCents: price ? moneyCents(price[1]) : 0, frequency: "MONTHLY", interval: 1, dueDay: firstDueDate ? Number(firstDueDate.slice(-2)) : 0,
    paymentMethod: all.includes("boleto bancario") ? "BOLETO_BANCARIO" : "", categoryId: "", accountId: "", customerId: "", warnings };
}
