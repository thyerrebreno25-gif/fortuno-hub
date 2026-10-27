import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAssistantClient, getAssistantMember } from "@/modules/assistant/auth";
import { publicHistoryMetadata } from "@/modules/assistant/category-history";
import { historyClientIds, historyUsesNotion } from "@/modules/assistant/context";
import { getRolePermissions } from "@/modules/permissions/permissions";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id, organizationId: member.organizationId, userId: member.userId },
    select: {
      id: true,
      title: true,
      clientId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      client: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, attachments: true, metadata: true, createdAt: true },
      },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  if (historyUsesNotion(conversation.messages) && !(await getRolePermissions(member.organizationId, member.role)).NOTION.canView) return NextResponse.json({ error: "Seu perfil não tem mais acesso ao conteúdo do Notion desta conversa." }, { status: 403 });
  const clientIds = [...new Set([...(conversation.clientId ? [conversation.clientId] : []), ...historyClientIds(conversation.messages)])];
  for (const clientId of clientIds) {
    if (!await findAssistantClient(member, clientId)) return NextResponse.json({ error: "Um cliente desta conversa não está mais disponível para seu usuário." }, { status: 403 });
  }
  return NextResponse.json({ conversation: { ...conversation,
    messages: conversation.messages.map((message) => ({ ...message, metadata: publicHistoryMetadata(message.metadata) })) } });
}

export async function PATCH(request: Request, context: Context) {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const current = await prisma.assistantConversation.findFirst({
    where: { id, organizationId: member.organizationId, userId: member.userId },
    select: { id: true },
  });
  if (!current) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { clientId?: unknown; title?: unknown; archive?: unknown };
  const data: { clientId?: string | null; title?: string; status?: "ARCHIVED" } = {};
  if (body.clientId === null || body.clientId === "") data.clientId = null;
  if (typeof body.clientId === "string" && body.clientId) {
    if (!await findAssistantClient(member, body.clientId)) {
      return NextResponse.json({ error: "Cliente não encontrado ou fora da sua responsabilidade." }, { status: 403 });
    }
    data.clientId = body.clientId;
  }
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 100);
  if (body.archive === true) data.status = "ARCHIVED";
  const conversation = await prisma.assistantConversation.update({ where: { id }, data });
  return NextResponse.json({ conversation });
}
