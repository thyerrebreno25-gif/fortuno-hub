import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findAssistantClient, getAssistantMember } from "@/modules/assistant/auth";

export async function POST(request: Request) {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { clientId?: unknown; title?: unknown };
  const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
  if (clientId && !await findAssistantClient(member, clientId)) {
    return NextResponse.json({ error: "Cliente não encontrado ou fora da sua responsabilidade." }, { status: 403 });
  }
  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 100)
    : "Nova conversa";
  const conversation = await prisma.assistantConversation.create({
    data: { organizationId: member.organizationId, userId: member.userId, clientId, title },
    select: { id: true, title: true, clientId: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ conversation }, { status: 201 });
}
