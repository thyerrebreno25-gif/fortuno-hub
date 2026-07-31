import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(request: Request, context: Context) {
  const member = await getOnboardingMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { taskId } = await context.params;
  const body = await request.json();
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "Comentário obrigatório." }, { status: 400 });

  const task = await prisma.onboardingTask.findFirst({ where: { id: taskId, onboarding: { organizationId: member.organizationId } } });
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

  const comment = await prisma.onboardingComment.create({
    data: { taskId, userId: member.userId, content },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  await prisma.onboardingHistory.create({ data: { onboardingId: task.onboardingId, userId: member.userId, action: "COMMENT_CREATED", entity: "ONBOARDING_TASK", entityId: taskId, afterData: comment } });
  return NextResponse.json({ comment }, { status: 201 });
}
