export function internalText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9/ -]+/g, " ").replace(/\s+/g, " ").trim();
}

export type InternalPeriod = { start: string; end: string };
export type InternalPlan = {
  kind: "GREETING" | "HELP" | "SEARCH" | "OVERVIEW" | "CATALOG" | "REPORT" | "LEARNING" | "WORKFLOW" | "UNKNOWN";
  query?: string;
  catalog?: "categories" | "cost_centers" | "financial_accounts";
  period?: InternalPeriod;
};

function validDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function internalPeriod(prompt: string, now = new Date()): InternalPeriod | undefined {
  const text = internalText(prompt);
  const previous = /\bmes (?:passado|anterior)\b|\bultimo mes\b/.test(text);
  const currentMonth = /\bmes (?:atual|corrente)\b|\b(?:este|esse|neste|nesse) mes\b/.test(text);
  if (previous && currentMonth) return undefined;
  const dates = [...text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b|\b(\d{2})\/(\d{2})\/(20\d{2})\b/g)]
    .map((match) => match[1] ? `${match[1]}-${match[2]}-${match[3]}` : `${match[6]}-${match[5]}-${match[4]}`);
  if (dates.length) {
    if (dates.length !== 2 || !dates.every(validDate) || dates[0] > dates[1]) return undefined;
    return { start: dates[0], end: dates[1] };
  }
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  let year = Number(current.find((part) => part.type === "year")?.value);
  let month = Number(current.find((part) => part.type === "month")?.value);
  const months = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const namedMatches = [...text.matchAll(new RegExp(`\\b(${months.join("|")})(?: de)? (20\\d{2})\\b`, "g"))];
  const numericMatches = [...text.matchAll(/\b(\d{2})\/(20\d{2})\b/g)];
  if (namedMatches.length + numericMatches.length > 1 || (previous || currentMonth) && (namedMatches.length || numericMatches.length)) return undefined;
  const named = namedMatches[0];
  const numeric = numericMatches[0];
  if (named) { year = Number(named[2]); month = months.indexOf(named[1]) + 1; }
  else if (numeric) { year = Number(numeric[2]); month = Number(numeric[1]); }
  else if (previous) { month -= 1; if (!month) { month = 12; year -= 1; } }
  else if (!currentMonth) return undefined;
  if (month < 1 || month > 12) return undefined;
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}` };
}

export function planInternalRequest(prompt: string, now = new Date()): InternalPlan {
  const text = internalText(prompt);
  if (/^(?:oi|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem)(?: assistente)?$/.test(text)) return { kind: "GREETING" };
  if (/\b(?:aprender|aprenda|aprendizado|identifique|identificar)\b.*\bcategor/.test(text)) return { kind: "LEARNING" };
  if (/\b(?:como|explique|explica|funciona|o que e|ajuda|duvida|onde)\b/.test(text)) return { kind: "HELP", query: prompt };
  if (/\b(?:lance|lancar|liquide|liquidar|exclua|excluir)\b|\bcriar (?:uma |a )?(?:despesa|receita|venda)\b|\b(?:envie|enviar|manda|mandar)\b.*\b(?:lancamentos?|faturas?|despesas?|receitas?|conta azul)\b/.test(text)) return { kind: "WORKFLOW", query: prompt };
  if (/\bcentros? de custo\b/.test(text)) return { kind: "CATALOG", catalog: "cost_centers" };
  if (/\bcategorias?\b/.test(text)) return { kind: "CATALOG", catalog: "categories" };
  if (/\bcontas? (?:financeiras?|correntes?)\b/.test(text)) return { kind: "CATALOG", catalog: "financial_accounts" };
  if (/\b(?:busque|buscar|procure|procurar|localize|localizar|listar|liste)\b.*\bclientes?\b|\bquais clientes\b/.test(text)) {
    return { kind: "SEARCH", query: text.replace(/^.*?\bclientes?\b\s*/, "").trim() };
  }
  if (/\b(?:audite|auditar|auditoria|relatorio|financeiro|financeira|vencidos|vencidas|saldos?|movimentacoes)\b|\bcontas a (?:pagar|receber)\b/.test(text)) {
    return { kind: "REPORT", period: internalPeriod(prompt, now) };
  }
  if (/\b(?:situacao|resuma|resumo|cadastro|responsaveis|responsavel|atividades|operacional|visao)\b.*\bcliente\b|\bcliente\b.*\b(?:situacao|cadastro|responsavel)\b/.test(text)) return { kind: "OVERVIEW" };
  return { kind: "UNKNOWN" };
}

/** Nomes não ambíguos; nunca escolher silenciosamente um cliente diferente do selecionado. */
export function requestedInternalClient(prompt: string) {
  const text = internalText(prompt);
  if (/\b(?:deste|desse|este|esse) cliente\b|\bcliente (?:selecionado|da conversa)\b/.test(text)) return "";
  const match = text.match(/\bcliente\s+(.+?)(?=\s+(?:(?:no|do|na|em)\s+(?:mes|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|(?:de|entre|em)\s+\d)|$)/);
  return match?.[1]?.trim() || "";
}
