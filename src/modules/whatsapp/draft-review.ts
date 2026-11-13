// Pure, bounded local rules. This module has no network, model, storage or account dependencies.
const words: Record<string, string> = {
  ola: "olá", voce: "você", voces: "vocês", nao: "não", tambem: "também", entao: "então",
  amanha: "amanhã", ja: "já", ate: "até", apos: "após", sera: "será", serao: "serão",
  proximo: "próximo", proximos: "próximos", proxima: "próxima", proximas: "próximas",
  reuniao: "reunião", reunioes: "reuniões", informacao: "informação", informacoes: "informações",
  solicitacao: "solicitação", solicitacoes: "solicitações", confirmacao: "confirmação",
  conciliacao: "conciliação", conciliacoes: "conciliações", transferencia: "transferência",
  transferencias: "transferências", necessario: "necessário", necessaria: "necessária",
  possivel: "possível", duvida: "dúvida", duvidas: "dúvidas", horario: "horário", horarios: "horários",
  relatorio: "relatório", relatorios: "relatórios", periodo: "período", periodos: "períodos",
  aniversario: "aniversário", operacao: "operação", operacoes: "operações", mes: "mês",
  mesnagem: "mensagem", mensagen: "mensagem", menssagem: "mensagem", menssagens: "mensagens",
  comprovamte: "comprovante", pagamneto: "pagamento", pagamnetos: "pagamentos", recebiemento: "recebimento",
  vc: "você", vcs: "vocês", tbm: "também", hj: "hoje", qdo: "quando", pfv: "por favor",
};

// Never rewrite identifiers or quoted code. Placeholders also protect financial
// values and preserve the exact original links, mentions, emails and formatting.
const protectedPattern = /(?:chave[ \t]+pix|pix|conta|ag[eê]ncia|cpf|cnpj)[ \t]*[:=][ \t]*\S+|```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|https?:\/\/[^\s<>]+|www\.[^\s<>]+|[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}|@(?:\d+|[\p{L}\d_]+)|\b[\p{L}\d-]+(?:\.[\p{L}\d-]+)+(?:\/[^\s<>]*)?|\b(?=[\p{L}\d_-]*\d)[\p{L}\d_-]+\b|\d+(?:[.,:/+-]\d+)*/giu;
function mask(value: string) {
  const protectedValues: string[] = [];
  const text = value.replace(protectedPattern, token => { const index=protectedValues.push(token)-1; return `\uE000${index}\uE001`; });
  return { text, restore: (candidate: string) => candidate.replace(/\uE000(\d+)\uE001/g, (_whole,index:string)=>protectedValues[Number(index)]) };
}
function firstUpper(value: string) { return value.replace(/^([a-zá-ú])/u, letter=>letter.toLocaleUpperCase("pt-BR")); }
function replaceWord(value: string) {
  // Capitalized/all-capital words may be people, companies or acronyms. Only
  // accept a capitalized greeting; broad dictionary suggestions remain native.
  if(value!==value.toLocaleLowerCase("pt-BR") && value!=="Ola") return value;
  const replacement=words[value.toLocaleLowerCase("pt-BR")];
  return replacement ? value==="Ola" ? firstUpper(replacement) : replacement : value;
}
export function reviewWhatsAppDraft(text: string) {
  if(text.length>5000 || /[\uE000\uE001]/u.test(text)) return {corrected:text,suggestions:[] as string[]};
  const protectedText=mask(text);
  let corrected=protectedText.text.replace(/[\p{L}]+/gu,replaceWord);
  corrected=corrected.replace(/\bapartir\b/gu,"a partir").replace(/\bporfavor\b/gu,"por favor");
  corrected=corrected.replace(/([^\n])[ \t]{2,}/g,"$1 ").replace(/[ \t]+([,!?;])/g,"$1").replace(/([,!?;])(?=[\p{L}])/gu,"$1 ");
  corrected=corrected.replace(/^(olá|oi|bom dia|boa tarde|boa noite)[ \t]+(?=tudo bem\b)/iu,"$1, ");
  corrected=corrected.replace(/\btudo bem[ \t]+(?=[\p{L}])/giu,"tudo bem? ");
  corrected=corrected.replace(/\bsegue (em anexo )?(os|as)\b/gu,"seguem $1$2");
  corrected=firstUpper(corrected).replace(/([!?][ \t]+)([a-zá-ú])/gu,(_whole,before:string,letter:string)=>before+letter.toLocaleUpperCase("pt-BR"));
  const question=/\b(?:tudo bem|como vai|como estão|pode confirmar|pode me confirmar)\s*$/iu.test(corrected) || /(?:^|[.!?][ \t]+)(?:podemos|poderia|você pode|vocês podem|consegue|conseguimos|qual|quando|como|por que)\b/iu.test(corrected);
  if(question && /[\p{L}]$/u.test(corrected)) corrected+="?";
  const suggestions:string[]=[];
  if(/^(?:Envie|Encaminhe|Confirme|Verifique|Informe|Compartilhe)\b/u.test(corrected) && !/por favor/iu.test(corrected)) suggestions.push("Por favor, "+corrected[0].toLocaleLowerCase("pt-BR")+corrected.slice(1));
  if(/^Olá, /u.test(corrected)) suggestions.push("Olá! "+firstUpper(corrected.slice(5)));
  const restored=protectedText.restore(corrected);
  if(restored.length>5000)return {corrected:text,suggestions:[]};
  return {corrected:restored,suggestions:suggestions.map(protectedText.restore).filter(item=>item!==text&&item.length<=5000)};
}
