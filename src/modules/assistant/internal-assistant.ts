import { searchPlatformGuide } from "./platform-knowledge";
import { internalText, planInternalRequest, requestedInternalClient } from "./internal-plan";
import { executeAssistantTool, type AssistantToolContext } from "./tools";
import type { AssistantUploadedFile } from "./files";

export type InternalAssistantResult = {
  text: string;
  toolEvents: Array<{ name: string; arguments: Record<string, unknown>; ok: boolean }>;
  consultedClientIds: string[];
  links: Array<{ label: string; href: string }>;
  reportTitle?: string;
};
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function array(value: unknown) { return Array.isArray(value) ? value.map(record) : []; }
function count(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? String(value) : "não informado"; }
function money(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value) : "não informado"; }
function name(value: unknown) { return typeof value === "string" ? value : "não informado"; }
const HELP = "Posso ajudar sem IA externa: explicar os módulos do Fortuno, buscar clientes, consultar cadastro e responsáveis, listar categorias/centros de custo/contas do Conta Azul e gerar um relatório financeiro preliminar.\n\nExperimente: ‘Como enviar uma fatura?’, ‘Resuma a situação deste cliente’ ou ‘Relatório financeiro deste cliente no mês passado’. Selecione o cliente no topo para consultas. Perguntas fora desses fluxos podem usar a IA externa, somente quando você ativar essa opção.";

export async function runInternalAssistant(input: {
  context: AssistantToolContext; prompt: string; client?: { id: string; name: string } | null;
  files: AssistantUploadedFile[]; ticketCodes: string[]; now?: Date;
}): Promise<InternalAssistantResult> {
  const result: InternalAssistantResult = { text: "", toolEvents: [], consultedClientIds: [], links: [] };
  const run = async (tool: string, args: Record<string, unknown>) => {
    try {
      const data = await executeAssistantTool(input.context, tool, JSON.stringify(args));
      result.toolEvents.push({ name: tool, arguments: args, ok: true });
      if (typeof args.client_id === "string") result.consultedClientIds.push(args.client_id);
      if (tool === "search_clients") result.consultedClientIds.push(...array(data).flatMap((item) => typeof item.id === "string" ? [item.id] : []));
      return data;
    } catch (error) {
      result.toolEvents.push({ name: tool, arguments: args, ok: false });
      throw error;
    }
  };
  try {
    if (input.files.length || input.ticketCodes.length) {
      const messages = input.files.map((file) => {
        const analysis = file.analysis;
        if (analysis?.supported === true) return `${file.name}: ${name(analysis.acquirer)}; ${count(analysis.importedLines)} lançamento(s); total ${money(analysis.total)}; ${count(analysis.reviewLines)} para revisão.\n${Object.entries(record(analysis.byEvent)).map(([event, values]) => `${event}: ${count(record(values).count)} item(ns), ${money(record(values).amount)}`).join("\n")}`;
        return `${file.name}: ${file.parserError || "Use o leitor específico na página de Faturas, Adquirentes, Extratos ou Notas de compra. Este modo não usa IA para interpretar arquivos sem leitor configurado."}`;
      });
      if (input.ticketCodes.length) messages.push(`Chamado(s) criado(s) para o suporte: ${input.ticketCodes.join(", ")}.`);
      messages.push("Leitura interna, sem OpenAI. Nenhum lançamento financeiro foi enviado ou criado. Revise os valores e classificações na tela de importação antes de enviar.");
      result.text = messages.join("\n\n"); result.links = [{ label: "Adquirentes", href: "/adquirentes" }, { label: "Faturas", href: "/faturas" }, { label: "Extratos", href: "/extratos" }];
      return result;
    }
    const plan = planInternalRequest(input.prompt, input.now);
    if (plan.kind === "GREETING" || plan.kind === "UNKNOWN") { result.text = HELP; return result; }
    if (plan.kind === "LEARNING") {
      result.text = "O aprendizado está na página de Faturas. Importe a fatura, clique em Aprender categorias, escolha a conta/cartão e o período do histórico no Conta Azul, revise e confirme. As categorias pendentes da fatura aberta serão preenchidas, e as regras ficarão salvas para próximas faturas. Não precisa da OpenAI e não altera lançamentos no Conta Azul.";
      result.links = [{ label: "Abrir Faturas", href: "/faturas" }]; return result;
    }
    if (plan.kind === "WORKFLOW") {
      result.text = "Posso orientar e consultar dados, mas não executo envios financeiros pelo chat interno. Use a tela da importação para revisar e confirmar o envio ao Conta Azul. Nenhum lançamento foi criado, liquidado ou excluído.";
      result.links = [{ label: "Faturas", href: "/faturas" }, { label: "Adquirentes", href: "/adquirentes" }, { label: "Notas de compra", href: "/notas-fiscais" }]; return result;
    }
    if (plan.kind === "HELP") {
      if (!/\b(?:fortuno|plataforma|sistema|faturas?|cartao|cartoes|adquirentes?|extratos?|ofx|notas?|xml|clientes?|categorias?|aprendizado|centro|avisos?|suporte|conta azul|senha|autenticacao|tema|auditoria|dashboard|inicio)\b/.test(internalText(input.prompt))) {
        result.text = HELP; return result;
      }
      result.text = searchPlatformGuide(plan.query || input.prompt).slice(0, 2).map((item) => item.content).join("\n\n") + "\n\nResposta da base interna do Fortuno, sem IA externa."; return result;
    }
    if (plan.kind === "SEARCH") {
      const clients = array(await run("search_clients", { query: plan.query || "" }));
      result.text = clients.length ? `Clientes disponíveis para seu usuário (até 20):\n${clients.map((client) => `• ${name(client.name)}${client.document ? ` — ${name(client.document)}` : ""}`).join("\n")}\n\nSelecione o cliente no topo para consultar seus dados.` : "Nenhum cliente localizado dentro do seu acesso. Confira o nome ou documento.";
      return result;
    }
    let client = input.client;
    const target = requestedInternalClient(input.prompt);
    if (target && (!client || internalText(client.name) !== target)) {
      const found = array(await run("search_clients", { query: target }));
      if (found.length !== 1 || typeof found[0].id !== "string" || typeof found[0].name !== "string") {
        result.text = "Não identifiquei um único cliente dentro do seu acesso. Selecione o cliente no topo da conversa e repita a solicitação."; return result;
      }
      client = { id: found[0].id, name: found[0].name };
    }
    if (!client) { result.text = "Selecione o cliente no topo da conversa para consultar informações ou gerar um relatório."; return result; }
    if (plan.kind === "NOTION") {
      const data = record(await run("get_client_notion_access", { client_id: client.id, query: input.prompt }));
      result.text = `${client.name} — consulta ao Notion\n\n${array(data.sections).map((section) => `${name(section.title)}\n${name(section.text)}`).join("\n\n") || "Não localizei informações de acesso no conteúdo consultado."}\n\n${(Array.isArray(data.notices) ? data.notices.filter((notice) => typeof notice === "string") : []).join("\n")}\n\nFonte: Notion, consultado em ${name(data.queriedAt)}. Conteúdo de referência; não foram executadas ações bancárias.`;
      if (typeof data.sourceUrl === "string") result.links = [{ label: "Abrir página de origem no Notion", href: data.sourceUrl }];
    } else if (plan.kind === "OVERVIEW") {
      const data = record(await run("get_client_overview", { client_id: client.id }));
      const connection = record(data.contaAzulConnection); const totals = record(data._count);
      result.text = `${client.name}\nDocumento: ${name(data.document)}\nLíder: ${name(record(data.operationLeader).name)}\nContas a pagar: ${name(record(data.payableResponsible).name)}\nContas a receber: ${name(record(data.receivableResponsible).name)}\nResponsável geral: ${name(record(data.generalResponsible).name)}\nConta Azul: ${connection.active === true ? name(connection.status) : "sem conexão ativa"}\nImportações registradas: ${count(totals.imports)}\nAuditorias registradas: ${count(totals.audits)}\n\nÚltimas importações:\n${array(data.imports).map((item) => `• ${name(item.originalName)} — ${name(item.status)}`).join("\n") || "Nenhuma importação registrada."}\n\nFonte: cadastro interno do Fortuno. Sem IA externa.`;
      result.reportTitle = `Resumo operacional - ${client.name}`;
    } else if (plan.kind === "CATALOG") {
      const data = record(await run("get_client_conta_azul_catalog", { client_id: client.id, catalog: plan.catalog, query: "" }));
      result.text = `${client.name} — cadastros do Conta Azul\n${array(data.items).map((item) => `• ${name(item.name)}${item.type ? ` (${name(item.type)})` : ""}`).join("\n") || "Nenhum cadastro localizado."}\n\n${count(data.count)} item(ns) retornado(s).${data.truncated ? " A lista é limitada; refine a consulta no Conta Azul." : ""} Consulta direta, sem OpenAI.`;
    } else if (plan.kind === "REPORT") {
      if (!plan.period) { result.text = "Informe um período válido: ‘mês atual’, ‘mês passado’, ‘agosto de 2026’ ou ‘de 01/08/2026 a 31/08/2026’. O relatório consulta lançamentos por vencimento."; return result; }
      const data = record(await run("audit_client_financials", { client_id: client.id, period_start: plan.period.start, period_end: plan.period.end }));
      const pay = record(data.payables), receive = record(data.receivables), fortuno = record(data.fortuno);
      const source = record(data.source);
      result.text = `RELATÓRIO FINANCEIRO PRELIMINAR\n${client.name}\nPeríodo: ${plan.period.start} a ${plan.period.end} (vencimento)\nConsultado em: ${name(source.queriedAt)}\n\nContas a pagar: ${count(pay.count)} lançamento(s), ${money(pay.amount)}\nVencidos em aberto: ${count(pay.overdueCount)}, ${money(pay.overdueAmount)}\nContas a receber: ${count(receive.count)} lançamento(s), ${money(receive.amount)}\nVencidos em aberto: ${count(receive.overdueCount)}, ${money(receive.overdueAmount)}\n\nSaldos atuais informados pelo Conta Azul (não são os saldos do fim do período):\n${array(data.accountBalances).map((item) => `• ${name(item.name)}: ${money(item.balance)}${item.error ? " — saldo indisponível" : ""}`).join("\n") || "Nenhum saldo disponível."}\n\nPendências internas: ${count(fortuno.openOperations)} atividade(s), ${count(fortuno.overdueOperations)} vencida(s), ${count(fortuno.openFindings)} achado(s) de auditoria em aberto.\n\nFontes: API do Conta Azul e pendências do Fortuno. Consulta por vencimento, limitada a 1.000 eventos por direção. Não compara com saldo bancário nem confirma conciliação completa, competência ou recorrências ausentes. Não substitui conferência documental. Gerado por regras internas, sem OpenAI; nenhum lançamento foi alterado.`;
      result.reportTitle = `Relatório financeiro - ${client.name} - ${plan.period.start}`;
    }
    return result;
  } catch (error) {
    result.text = `Não foi possível concluir a consulta interna: ${error instanceof Error ? error.message : "falha inesperada"}. Nenhuma chamada à OpenAI foi feita.`;
    return result;
  }
}
