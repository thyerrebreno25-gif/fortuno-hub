import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

type Context = { params: Promise<{ taskId: string }> };

export async function POST(_: Request, context: Context) {
  const member = await getOnboardingMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { taskId } = await context.params;
  const entry = await prisma.onboardingTimeEntry.findFirst({
    where: { taskId, userId: member.userId, endedAt: null, task: { onboarding: { organizationId: member.organizationId } } },
    orderBy: { startedAt: "desc" },
  });
  if (!entry) return NextResponse.json({ error: "Nenhum cronômetro ativo." }, { status: 404 });
  const endedAt = new Date();
  const seconds = Math.max(1, Math.floor((endedAt.getTime() - entry.startedAt.getTime()) / 1000));
  const updated = await prisma.onboardingTimeEntry.update({ where: { id: entry.id }, data: { endedAt, seconds } });
  return NextResponse.json({ entry: updated });
}
