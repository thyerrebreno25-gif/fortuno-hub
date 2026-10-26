import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { encryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { notionAccess, notionFailure, notionFetch, notionToken } from "@/modules/notion/server";
import { list, notionBlock, notionItem, object, string } from "@/modules/notion/model";
const input = z.object({ view: z.enum(["status", "search", "page", "blocks", "data_source", "database"]).default("status"), id: z.string().uuid().optional(), query: z.string().max(200).default(""), kind: z.enum(["all", "page", "data_source"]).default("all"), cursor: z.string().max(4000).optional() });
const connectionSelect = { botName: true, workspaceName: true, checkedAt: true } as const;
export async function GET(request: Request) {
  try {
    const { member, permission } = await notionAccess();
    const params = input.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (params.view === "status") {
      const connection = await prisma.notionConnection.findUnique({ where: { organizationId: member.organizationId }, select: connectionSelect });
      return NextResponse.json({ connection, canManage: permission.canManage, configured: Boolean(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || process.env.GMAIL_TOKEN_ENCRYPTION_KEY) });
    }
    const token = await notionToken(member.organizationId);
    const pagination = { page_size: 50, ...(params.cursor ? { start_cursor: params.cursor } : {}) };
    if (params.view === "search") {
      const result = await notionFetch(token, "/search", { ...pagination, ...(params.query ? { query: params.query } : {}), sort: { direction: "descending", timestamp: "last_edited_time" }, ...(params.kind === "all" ? {} : { filter: { property: "object", value: params.kind } }) });
      return NextResponse.json({ items: list(result.results).filter((item) => !object(item).in_trash && !object(item).is_archived && !object(item).archived).map(notionItem), cursor: result.has_more ? result.next_cursor : null });
    }
    const id = z.string().uuid().parse(params.id);
    if (params.view === "blocks") {
      const result = await notionFetch(token, `/blocks/${id}/children?${new URLSearchParams({ page_size: "50", ...(params.cursor ? { start_cursor: params.cursor } : {}) })}`);
      return NextResponse.json({ blocks: list(result.results).map(notionBlock), cursor: result.has_more ? result.next_cursor : null });
    }
    if (params.view === "data_source") {
      const source = await notionFetch(token, `/data_sources/${id}`);
      const result = await notionFetch(token, `/data_sources/${id}/query`, pagination);
      return NextResponse.json({ item: notionItem(source), columns: Object.keys(object(source.properties)), items: list(result.results).map(notionItem), cursor: result.has_more ? result.next_cursor : null });
    }
    if (params.view === "database") {
      const result = await notionFetch(token, `/databases/${id}`);
      return NextResponse.json({ item: notionItem(result), sources: list(result.data_sources).map((entry) => ({ id: string(object(entry).id), title: string(object(entry).name), kind: "data_source" })) });
    }
    const result = await notionFetch(token, `/pages/${id}`);
    return NextResponse.json({ item: notionItem(result) });
  } catch (error) { return notionFailure(error); }
}
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
