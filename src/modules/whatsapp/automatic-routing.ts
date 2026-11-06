import type { WhatsAppRoutingArea } from "./core";
export const AUTOMATIC_WHATSAPP_PREFIX = "Automático WhatsApp: ";
export const normalizeRoutingText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const has = (text: string, phrase: string) => (" " + text + " ").includes(" " + phrase + " ");
const AP: Array<[string, number]> = [["contas a pagar", 20], ["pagar", 10], ["pague", 10], ["pagamos", 8], ["fornecedor", 8], ["fornecedores", 8], ["pagamento", 5], ["pagamentos", 8], ["comprovante de pagamento", 12], ["janela de pagamento", 15], ["fatura", 7], ["folha de pagamento", 15]];
const AR: Array<[string, number]> = [["contas a receber", 20], ["a receber", 20], ["emitir boleto", 22], ["emissao de boleto", 22], ["gerar boleto", 22], ["boleto emitido", 22], ["emitir nota", 20], ["emitir a nota", 20], ["emissao de nota", 20], ["nota fiscal emitida", 22], ["cobrar cliente", 22], ["cobrar", 10], ["enviar cobranca", 18], ["cobranca do cliente", 15], ["cliente pagou", 20], ["cliente precisa pagar", 20], ["pagamento do cliente", 20], ["recebimento", 10], ["recebimentos", 10], ["recebido", 8], ["recebi", 8], ["inadimplencia", 15], ["inadimplente", 15], ["adquirente", 8], ["recebiveis", 12]];
export function classifyWhatsappArea(subject: string, body: string, attachments: string[] = []): { area: WhatsAppRoutingArea; reason: string } {
  const text = normalizeRoutingText([subject, body, ...attachments].join(" "));
  const payableText = AR.filter(([,weight]) => weight >= 18).reduce((value, [phrase]) => value.replaceAll(phrase, " "), text);
  const ap = AP.filter(([term]) => has(payableText, term));
  const ar = AR.filter(([term]) => has(text, term));
  const payable = ap.reduce((sum, [,weight]) => sum + weight, 0), receivable = ar.reduce((sum, [,weight]) => sum + weight, 0);
  if (has(text, "contas a pagar") && has(text, "contas a receber") || payable >= 8 && receivable >= 8) return { area: "UNKNOWN", reason: "Mensagem envolve pagar e receber; aguardando triagem." };
  if (payable >= 7 && payable >= receivable + 8) return { area: "ACCOUNTS_PAYABLE", reason: "Contas a pagar: " + ap.map(([term]) => term).join(", ") + "." };
  if (receivable >= 8 && receivable >= payable + 8) return { area: "ACCOUNTS_RECEIVABLE", reason: "Contas a receber: " + ar.map(([term]) => term).join(", ") + "." };
  if (payable || receivable || /\b(?:boleto|nota fiscal|pix|cobranca|financeiro)\b/.test(text)) return { area: "UNKNOWN", reason: "Assunto financeiro sem indicação suficiente da área; aguardando triagem." };
  if ((!body.trim() && attachments.length) || /^\[[^\]]*(?:image|audio|video|document|sticker)[^\]]*\]$/i.test(body.trim())) return { area: "UNKNOWN", reason: "Mídia sem texto suficiente para identificar a área; aguardando triagem." };
  return { area: "GENERAL", reason: "Atendimento geral." };
}
type NamedClient = { id: string; name: string; document: string | null; serviceAliases: string | null };
const generic = new Set(["a","o","as","os","e","de","da","das","do","dos","ltda","limitada","eireli","me","sa","s","a","comercio","servicos","servico","empresa","empresas","financeiro","financeira","fortuno","bpo","grupo","cliente","atendimento","assessoria","contabilidade","distribuidora","distribuidor","investimentos","advocacia","consultoria","logistica","holding","agropecuaria","restaurante","lanchonete","epp","sociedade","individual","empresarial","centro","treinamento","academia","condominio","residencial","banco","pagamentos","recebimentos","odontologia","carnes"]);
export function matchWhatsappGroup<T extends NamedClient>(name: string, clients: T[]): { client: T | null; ambiguous: boolean; reason: string } {
  const normalized = normalizeRoutingText(name), digits = name.replace(/\D/g, "");
  const documents = clients.filter(client => { const doc = (client.document || "").replace(/\D/g, ""); return doc.length >= 11 && digits.includes(doc); });
  if (documents.length) return { client: documents.length === 1 ? documents[0] : null, ambiguous: documents.length !== 1, reason: "CPF/CNPJ encontrado no nome do grupo." };
  const matches = clients.filter(client => {
    const aliases = [client.name, ...(client.serviceAliases || "").split(/[,;\n]/)].map(normalizeRoutingText).filter(Boolean);
    if (aliases.some(alias => alias === normalized || alias.length >= 3 && has(normalized, alias))) return true;
    const terms = normalizeRoutingText(client.name).split(" ").filter(term => term.length >= 3 && !generic.has(term));
    const hits = terms.filter(term => has(normalized, term));
    if (hits.length >= 2) return true;
    return hits.some(term => term.length >= 5 && clients.filter(other => normalizeRoutingText(other.name).split(" ").includes(term)).length === 1);
  });
  return { client: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1, reason: matches.length === 1 ? "Cliente reconhecido pelo nome/alias do grupo." : matches.length > 1 ? "Nome do grupo corresponde a mais de um cliente; aguardando seleção." : "Grupo ainda não identificado; confira o nome ou os aliases do cliente." };
}
export function mayAutomaticallyRoute(ticket: { assignedToId: string | null; firstResponseAt: Date | null; routingReason: string | null }, area: WhatsAppRoutingArea) {
  return !ticket.assignedToId || ticket.routingReason?.startsWith(AUTOMATIC_WHATSAPP_PREFIX) && !ticket.firstResponseAt && (area === "ACCOUNTS_PAYABLE" || area === "ACCOUNTS_RECEIVABLE");
}
