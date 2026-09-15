import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  assistantClientAccessWhere,
  getAssistantMember,
} from "@/modules/assistant/auth";

export async function GET() {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });

  const [clients, conversations] = await Promise.all([
    prisma.client.findMany({
      where: {
        organizationId: member.organizationId,
        active: true,
        ...assistantClientAccessWhere(member),
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        document: true,
        contaAzulConnection: { select: { active: true, status: true } },
      },
    }),
    prisma.assistantConversation.findMany({
      where: { organizationId: member.organizationId, userId: member.userId, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        title: true,
        clientId: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true } },
      },
    }),
  ]);

  return NextResponse.json({
    configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    currentUser: {
      id: member.userId,
      name: member.user.name || member.user.email,
      role: member.role,
    },
    clients: clients.map(({ contaAzulConnection, ...client }) => ({
      ...client,
      contaAzulConnected: Boolean(contaAzulConnection?.active && contaAzulConnection.status === "CONNECTED"),
    })),
    conversations: conversations.map(({ messages, ...conversation }) => ({
      ...conversation,
      preview: messages[0]?.content || "Conversa sem mensagens",
    })),
  });
}
