import { NextResponse } from "next/server";
import { getOperationMember } from "@/modules/operations/auth";
import { OperationTimerError } from "@/modules/operations/timer-server";
import { deleteRoutineSelection, previewRoutineDeletion } from "@/modules/operations/routine-delete-server";
import { editRoutine } from "@/modules/operations/routine-edit-server";
import { routineEditSchema } from "@/modules/operations/edit-model";
export const maxDuration = 60;
type Context = { params: Promise<{ id: string }> };
const failure = (error: unknown) => NextResponse.json({ error: error instanceof OperationTimerError ? error.message : "Não foi possível conferir ou excluir a rotina. Tente novamente." }, { status: error instanceof OperationTimerError ? error.status : 500 });
export async function GET(_request: Request, context: Context) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const { id } = await context.params;
    return NextResponse.json({ impact: await previewRoutineDeletion(member, id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const { id } = await context.params, body = await request.json().catch(() => ({})) as Record<string, unknown>;
    return NextResponse.json(await deleteRoutineSelection(member, id, { reason: typeof body.reason === "string" ? body.reason : "", confirmation: typeof body.confirmation === "string" ? body.confirmation : "", fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : "" }));
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const member = await getOperationMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const { id } = await context.params, parsed = routineEditSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Confira a programação." }, { status: 400 });
    return NextResponse.json(await editRoutine(member, id, parsed.data));
  } catch (error) { return NextResponse.json({ error: error instanceof OperationTimerError ? error.message : "Não foi possível editar a rotina. Atualize a lista e tente novamente." }, { status: error instanceof OperationTimerError ? error.status : 500 }); }
}
