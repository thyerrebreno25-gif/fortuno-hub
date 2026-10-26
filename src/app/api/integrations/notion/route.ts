import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { NotionError, notionAccess, notionFailure, notionFetch, notionToken, readNotionBlocks } from "@/modules/notion/server";
import { list, notionColumns, notionItem, notionQuery, object, propertyPathId, string } from "@/modules/notion/model";
const input = z.object({ view: z.enum(["status", "search", "page", "blocks", "data_source", "database", "relation"]).default("status"), id: z.string().uuid().optional(), query: z.string().max(200).default(""), kind: z.enum(["all", "page", "data_source"]).default("all"), cursor: z.string().max(4000).optional(), property: z.string().max(200).optional(), filterField: z.string().max(200).optional(), filterValue: z.string().max(200).optional(), sortField: z.string().max(200).optional(), direction: z.enum(["ascending", "descending"]).default("ascending") });
const connectionSelect = { botName: true, workspaceName: true, checkedAt: true } as const;
export async function GET(request: Request) {
  try {
    const { member, permission } = await notionAccess();
    const params = input.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (params.view === "status") {
      const connection = await prisma.notionConnection.findUnique({ where: { organizationId: member.organizationId }, select: connectionSelect });
      return NextResponse.json({ connection, organizationId: member.organizationId, canManage: permission.canManage, configured: Boolean(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY) });
    }
    const token = await notionToken(member.organizationId);
    const pagination = { page_size: 50, ...(params.cursor ? { start_cursor: params.cursor } : {}) };
    if (params.view === "search") {
      const result = await notionFetch(token, "/search", { ...pagination, ...(params.query ? { query: params.query } : {}), sort: { direction: "descending", timestamp: "last_edited_time" }, ...(params.kind === "all" ? {} : { filter: { property: "object", value: params.kind } }) });
      return NextResponse.json({ items: list(result.results).filter((item) => !object(item).in_trash && !object(item).is_archived && !object(item).archived).map(notionItem), cursor: result.has_more ? result.next_cursor : null });
    }
    const id = z.string().uuid().parse(params.id);
    if (params.view === "relation") {
      const property = z.string().min(1).max(200).parse(params.property);
      const result = await notionFetch(token, `/pages/${id}/properties/${propertyPathId(property)}?${new URLSearchParams({ page_size: "8", ...(params.cursor ? { start_cursor: params.cursor } : {}) })}`);
      const items = [];
      for (const entry of list(result.results)) {
        const relatedId = z.string().uuid().safeParse(object(object(entry).relation).id);
        if (!relatedId.success) continue;
        if (items.length) await new Promise((resolve) => setTimeout(resolve, 400));
        try { items.push(notionItem(await notionFetch(token, `/pages/${relatedId.data}`))); }
        catch (error) { if (error instanceof NotionError && [403, 404].includes(error.status)) items.push({ id: relatedId.data, kind: "page", title: "Página sem acesso pela integração", unavailable: true }); else throw error; }
      }
      return NextResponse.json({ items, cursor: result.has_more ? result.next_cursor : null });
    }
    if (params.view === "blocks") {
      return NextResponse.json(await readNotionBlocks(token, id, params.cursor));
    }
    if (params.view === "data_source") {
      const source = await notionFetch(token, `/data_sources/${id}`);
      let filters;
      try { filters = notionQuery(source, params); } catch { throw new NotionError("Selecione um filtro válido para esta base."); }
      const result = await notionFetch(token, `/data_sources/${id}/query`, { ...pagination, ...filters });
      return NextResponse.json({ item: notionItem(source), columns: Object.keys(object(source.properties)), columnSchema: notionColumns(source), items: list(result.results).map(notionItem), cursor: result.has_more ? result.next_cursor : null });
    }
    if (params.view === "database") {
      const result = await notionFetch(token, `/databases/${id}`);
      return NextResponse.json({ item: notionItem(result), sources: list(result.data_sources).map((entry) => ({ id: string(object(entry).id), title: string(object(entry).name), kind: "data_source" })) });
    }
    const result = await notionFetch(token, `/pages/${id}`);
    return NextResponse.json({ item: notionItem(result) });
  } catch (error) { return notionFailure(error); }
}
export const maxDuration = 180;
export async function POST(request: Request) {
  try {
    const { member } = await notionAccess(true);
    const { token } = z.object({ token: z.string().trim().min(20).max(500).regex(/^[A-Za-z0-9_-]+$/) }).parse(await request.json());
    const encryptedToken = encryptIntegrationSecret(token);
    const bot = await notionFetch(token, "/users/me");
    // Also validate read access before replacing an existing working credential.
    await notionFetch(token, "/search", { page_size: 1 });
    const data = { encryptedToken, botName: string(bot.name) || "Notion", botId: string(bot.id), workspaceName: string(object(bot.bot).workspace_name) || "Workspace Notion", connectedById: member.userId, checkedAt: new Date() };
    const connection = await prisma.notionConnection.upsert({ where: { organizationId: member.organizationId }, create: { organizationId: member.organizationId, ...data }, update: data, select: connectionSelect });
    return NextResponse.json({ connection });
  } catch (error) { return notionFailure(error); }
}
export async function DELETE() {
  try {
    const { member } = await notionAccess(true);
    await prisma.notionConnection.deleteMany({ where: { organizationId: member.organizationId } });
    return NextResponse.json({ ok: true });
  } catch (error) { return notionFailure(error); }
}
