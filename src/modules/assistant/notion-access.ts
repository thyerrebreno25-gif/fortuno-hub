import { prisma } from "@/lib/prisma";
import { getRolePermissions } from "@/modules/permissions/permissions";
import { notionFetch, notionToken, readNotionBlocks } from "@/modules/notion/server";
import { list, notionItem, object, string } from "@/modules/notion/model";
import { findAssistantClient, type AssistantMember } from "./auth";
import { internalText } from "./internal-plan";

export async function getClientNotionAccess(member: AssistantMember, clientId: string, query: string) {
  const client = await findAssistantClient(member, clientId);
  if (!client) throw new Error("Cliente não encontrado ou fora do seu acesso.");
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (member.role === "CLIENT" || !permissions.NOTION.canView) throw new Error("Seu perfil precisa de acesso ao módulo Notion para consultar os acessos do cliente.");
  const token = await notionToken(member.organizationId);
  const mapping = await prisma.clientManagement.findFirst({ where: { clientId, organizationId: member.organizationId }, select: { notionPageId: true } });
  let pageId = mapping?.notionPageId;
  if (!pageId) {
    const found = await notionFetch(token, "/search", { query: client.name, filter: { property: "object", value: "page" }, page_size: 100 });
    const matches = list(found.results).filter((raw) => { const item = object(raw); return !item.archived && !item.in_trash && internalText(notionItem(raw).title) === internalText(client.name); });
    if (found.has_more || matches.length !== 1) throw new Error("Vincule a página correta deste cliente em Gestão > Página do cliente no Notion. Não foi localizada uma única página com o nome exato.");
    pageId = string(object(matches[0]).id);
  }
  const root = notionItem(await notionFetch(token, `/pages/${pageId}`));
  const sections: Array<{ title: string; url: string; text: string }> = [];
  const notices: string[] = [];
  const visited = new Set<string>(), deadline = Date.now() + 90000;
  let remoteCalls = 0;
  const read = async (path: string, body?: unknown) => {
    if (Date.now() > deadline || remoteCalls++ >= 20) throw new Error("A consulta do Notion atingiu o limite. Abra a página de origem para os detalhes restantes.");
    if (remoteCalls > 1) await new Promise((resolve) => setTimeout(resolve, 400));
    return notionFetch(token, path, body);
  };
  const bankNames = ["banco do brasil", "mercado pago", "btg", "itau", "bradesco", "santander", "inter", "nubank", "sicoob", "sicredi", "caixa", "cora", "safra", "c6", "bs2"];
  const normalized = internalText(query), bank = bankNames.find((name) => new RegExp(`\\b${name}\\b`).test(normalized));
  const collectSource = async (sourceId: string, constraints: unknown[], title: string, url: string) => {
    const rows = await read(`/data_sources/${sourceId}/query`, { page_size: 50, ...(constraints.length ? { filter: { and: constraints } } : {}) });
    const items = list(rows.results).map(notionItem);
    const matching = bank ? items.filter((item) => internalText(JSON.stringify(item.properties)).includes(bank)) : items;
    const text = matching.map((item) => `${item.title}\n${Object.entries(item.properties).map(([key, value]) => `${key}: ${value}`).join("\n")}`).join("\n\n");
    if (text) sections.push({ title, url, text });
    if (rows.has_more) notices.push(`A lista ${title} possui mais de 50 registros. Refine a consulta ou abra a origem.`);
  };
  const walk = async (id: string, title: string, url: string, depth: number) => {
    if (visited.has(id)) return;
    visited.add(id);
    if (visited.size > 6 || depth > 2 || Date.now() > deadline) { notices.push("Há páginas adicionais que não foram consultadas."); return; }
    const page = await read(`/pages/${id}`);
    const properties = notionItem(page).properties;
    const blocks = await readNotionBlocks(token, id);
    const lines = [...Object.entries(properties).map(([key, value]) => `${key}: ${value}`), ...blocks.blocks.filter((block) => !["child_page", "child_database", "link_to_page"].includes(block.type)).map((block) => block.text).filter(Boolean)];
    if (lines.length) sections.push({ title, url, text: lines.join("\n") });
    if (blocks.cursor) notices.push(`A página ${title} possui mais conteúdo não consultado.`);
    for (const block of blocks.blocks) {
      if (Date.now() > deadline) { notices.push("Consulta parcial por limite de tempo."); break; }
      if (block.type === "child_page" && (!bank || internalText(block.text).includes(bank) || /acess|banc|financeir|senhas|dados/.test(internalText(block.text)))) {
        await walk(block.id, block.text || "Detalhes do cliente", `https://www.notion.so/${block.id.replaceAll("-", "")}`, depth + 1);
      }
      if (block.type === "child_database") {
        const database = await read(`/databases/${block.id}`);
        const sources = list(database.data_sources);
        // Only owned databases or constrained saved views may supply rows.
        // Linked databases without client restrictions could expose other clients.
        const parent = object(database.parent);
        if (sources.length && string(parent.page_id).replaceAll("-", "") === id.replaceAll("-", "")) {
          for (const source of sources.slice(0, 2)) await collectSource(string(object(source).id), [], block.text, url);
        } else {
          const views = await read(`/views?${new URLSearchParams({ database_id: block.id, page_size: "5" })}`);
          for (const raw of list(views.results).slice(0, 3)) {
            const view = await read(`/views/${string(object(raw).id)}`);
            const constraints = [view.filter, ...Object.entries(object(view.quick_filters)).filter(([, value]) => Object.keys(object(value)).length).map(([property, condition]) => ({ property, ...object(condition) }))].filter((condition) => Object.keys(object(condition)).length);
            if (constraints.length) await collectSource(string(view.data_source_id), constraints, string(view.name) || block.text, url);
            else notices.push(`A lista ${block.text} não tem restrição de cliente salva; consulte a origem.`);
          }
        }
      }
    }
  };
  try { await walk(pageId, root.title, root.url || `https://www.notion.so/${pageId.replaceAll("-", "")}`, 0); }
  catch (error) { if (!sections.length) throw error; notices.push(error instanceof Error ? error.message : "Consulta parcial."); }
  let remaining = 16000;
  const relevant = bank ? sections.filter((section) => internalText(`${section.title} ${section.text}`).includes(bank)) : sections;
  if (bank && !relevant.length) notices.push(`Não localizei ${bank} no conteúdo consultado. Confira o vínculo e as páginas de origem.`);
  const bounded = relevant.map((section) => { const text = section.text.slice(0, Math.max(0, remaining)); remaining -= text.length; if (text.length < section.text.length) notices.push("Parte do conteúdo foi limitada; consulte a origem para os detalhes completos."); return { ...section, text }; }).filter((section) => section.text);
  await prisma.auditLog.create({ data: { userId: member.userId, action: "ASSISTANT_NOTION_ACCESS_READ", entity: "Client", entityId: client.id, afterData: { pageId, sectionCount: bounded.length } } });
  return { client, queriedAt: new Date().toISOString(), sections: bounded, notices: [...new Set(notices)], sourceUrl: root.url || `https://www.notion.so/${pageId.replaceAll("-", "")}` };
}
