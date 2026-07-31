import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(_: Request, context: Context) {
  const member = await getOnboardingMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { taskId } = await context.params;
  const task = await prisma.onboardingTask.findFirst({ where: { id: taskId, onboarding: { organizationId: member.organizationId } } });
  if (!task) return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });

  const alreadyOpen = await prisma.onboardingTimeEntry.findFirst({ where: { taskId, userId: member.userId, endedAt: null } });
  if (alreadyOpen) return NextResponse.json({ entry: alreadyOpen });

  const entry = await prisma.$transaction(async (tx) => {
    await tx.onboardingTask.update({ where: { id: taskId }, data: { status: "IN_PROGRESS", startedAt: task.startedAt ?? new Date() } });
    return tx.onboardingTimeEntry.create({ data: { taskId, userId: member.userId, startedAt: new Date() } });
  });
  return NextResponse.json({ entry }, { status: 201 });
}
