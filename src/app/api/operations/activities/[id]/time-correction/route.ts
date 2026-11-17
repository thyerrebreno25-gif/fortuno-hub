import { NextResponse } from "next/server";
import { getOperationMember } from "@/modules/operations/auth";
import { OperationTimerError } from "@/modules/operations/timer-server";
import { correctOperationTime } from "@/modules/operations/time-correction-server";
import { timeCorrectionSchema } from "@/modules/operations/time-correction";
import { correctActivityDuration } from "@/modules/operations/duration-correction-server";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const input = timeCorrectionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: "Confira a duração informada e a justificativa de pelo menos 5 caracteres." }, { status: 400 });
    const { id } = await context.params;
    const entry = "mode" in input.data ? await correctActivityDuration(member, id, input.data) : await correctOperationTime(member, id, input.data);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof OperationTimerError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Não foi possível salvar a correção. Tente novamente." }, { status: 500 });
  }
}
