import { NextResponse } from "next/server";
import { getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";
import { onboardingService } from "@/modules/onboarding/services/onboarding.service";

type Context = { params: Promise<{ taskId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const { taskId } = await context.params;
    const body = await request.json();
    const task = await onboardingService.updateTask(taskId, member.organizationId, member.userId, body);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "TASK_NOT_FOUND") return NextResponse.json({ error: "Tarefa não encontrada." }, { status: 404 });
    if (message === "BLOCK_DATA_REQUIRED") return NextResponse.json({ error: "Informe o motivo e o responsável pelo desbloqueio." }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Não foi possível atualizar a tarefa." }, { status: 500 });
  }
}
