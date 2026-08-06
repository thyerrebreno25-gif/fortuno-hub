import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOperationMember } from "@/modules/operations/auth";
import { activityInclude, createEvent } from "@/modules/operations/activity";
import { sendOperationCompletionEmail } from "@/modules/operations/email";

type Context = { params: Promise<{ id: string }> };

type Member = NonNullable<Awaited<ReturnType<typeof getOperationMember>>>;

async function finalizeActivity(id: string, member: Member, note?: string | null) {
  const current = await prisma.operationActivity.findUnique({ where: { id }, include: activityInclude });
  if (!current) return { error: "Atividade não encontrada.", status: 404 } as const;
  if (current.status === "COMPLETED") return { activity: current } as const;

  const missing = current.checklistItems.filter((item) => item.mandatory && !item.completed);
  if (missing.length) {
    return { error: `Conclua os itens obrigatórios: ${missing.map((item) => item.title).join(", ")}`, status: 400 } as const;
  }
  if (current.process.requiresAttachment && !current.attachments.length) {
    return { error: "Esta atividade exige pelo menos um anexo.", status: 400 } as const;
  }
  const missingChecklistFiles = current.checklistItems.filter((item) => item.mandatory && item.requiresAttachment && !current.attachments.some((file) => file.checklistItemId === item.id));
  if (missingChecklistFiles.length) {
    return { error: `Anexe os arquivos obrigatórios: ${missingChecklistFiles.map((item) => item.title).join(", ")}`, status: 400 } as const;
  }

  const completedAt = new Date();
  const openEntries = current.timeEntries.filter((entry) => !entry.endedAt);
  for (const entry of openEntries) {
    await prisma.operationTimeEntry.update({
      where: { id: entry.id },
      data: { endedAt: completedAt, seconds: Math.max(1, Math.floor((completedAt.getTime() - entry.startedAt.getTime()) / 1000)) },
    });
  }
  if (openEntries.length) {
    await createEvent(id, member.userId, "PAUSED", "Cronômetro encerrado automaticamente na conclusão da atividade.");
  }

  await prisma.operationActivity.update({
    where: { id },
    data: { status: "COMPLETED", completedAt, completionNote: note?.trim() || null },
  });
  await createEvent(id, member.userId, "COMPLETED", `${member.user.name || member.user.email} concluiu a atividade.`);

  const fresh = await prisma.operationActivity.findUnique({ where: { id }, include: activityInclude });
  if (!fresh) return { error: "Atividade não encontrada.", status: 404 } as const;
  const recipients = [fresh.client.operationalEmail, ...(fresh.client.operationalEmailCc || "").split(",")]
    .map((value) => value?.trim()).filter(Boolean) as string[];
  const totalSeconds = fresh.timeEntries.reduce((sum, entry) => sum + Number(entry.seconds || 0), 0);
  const shouldNotify = fresh.clientProcess ? fresh.clientProcess.notifyClient : fresh.process.notifyClient;

  if (shouldNotify && recipients.length) {
    const mail = await sendOperationCompletionEmail({
      to: recipients,
      activityId: id,
      title: fresh.title,
      clientName: fresh.client.name,
      responsibleName: fresh.responsible?.name || fresh.responsible?.email || member.user.name || member.user.email,
      completedAt,
      totalSeconds,
      checklistDone: fresh.checklistItems.filter((item) => item.completed).length,
      checklistTotal: fresh.checklistItems.length,
      files: fresh.attachments.map((attachment) => attachment.name),
      note: fresh.completionNote,
    });
    await prisma.operationActivity.update({
      where: { id },
      data: { emailStatus: mail.sent ? "SENT" : "FAILED", emailSentAt: mail.sent ? new Date() : null },
    });
    await createEvent(id, member.userId, mail.sent ? "EMAIL_SENT" : "EMAIL_FAILED", mail.sent
      ? `E-mail de conclusão enviado para ${recipients.join(", ")}.`
      : `Falha ao enviar e-mail: ${mail.reason}`);
  } else if (shouldNotify && !recipients.length) {
    await prisma.operationActivity.update({ where: { id }, data: { emailStatus: "NO_RECIPIENT" } });
    await createEvent(id, member.userId, "EMAIL_FAILED", "Atividade concluída, mas o cliente não possui e-mail operacional cadastrado.");
  }

  return { activity: await prisma.operationActivity.findUnique({ where: { id }, include: activityInclude }) } as const;
}

export async function GET(_: Request, context: Context) {
  const member = await getOperationMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { id } = await context.params;
  const activity = await prisma.operationActivity.findFirst({ where: { id, organizationId: member.organizationId }, include: activityInclude });
  return activity ? NextResponse.json({ activity }) : NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });
}

export async function PATCH(request: Request, context: Context) {
  const member = await getOperationMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { id } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;
  const current = await prisma.operationActivity.findFirst({ where: { id, organizationId: member.organizationId }, include: activityInclude });
  if (!current) return NextResponse.json({ error: "Atividade não encontrada." }, { status: 404 });

  if (body.action === "checklist") {
    const item = current.checklistItems.find((row) => row.id === body.itemId);
    if (!item) return NextResponse.json({ error: "Item não encontrado." }, { status: 404 });
    const completed = Boolean(body.completed);
    const comment = typeof body.comment === "string" ? body.comment : item.comment;
    if (completed && item.requiresComment && !String(comment || "").trim()) {
      return NextResponse.json({ error: "Este item exige comentário." }, { status: 400 });
    }
    await prisma.operationChecklistItem.update({
      where: { id: item.id },
      data: { completed, completedAt: completed ? new Date() : null, completedById: completed ? member.userId : null, comment },
    });
    await createEvent(id, member.userId, completed ? "CHECKLIST_COMPLETED" : "CHECKLIST_REOPENED",
      `${member.user.name || member.user.email} ${completed ? "concluiu" : "reabriu"} o checklist “${item.title}”.`);

    if (completed) {
      const fresh = await prisma.operationActivity.findUnique({ where: { id }, include: activityInclude });
      const allMandatoryDone = fresh?.checklistItems.filter((row) => row.mandatory).every((row) => row.completed);
      if (fresh && allMandatoryDone && fresh.status !== "COMPLETED") {
        const result = await finalizeActivity(id, member, fresh.completionNote);
        if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
        return NextResponse.json({ activity: result.activity, autoCompleted: true });
      }
    }
  } else if (body.action === "comment") {
    const content = String(body.content || "").trim();
    if (!content) return NextResponse.json({ error: "Escreva um comentário." }, { status: 400 });
    await prisma.operationComment.create({ data: { activityId: id, userId: member.userId, content } });
    await createEvent(id, member.userId, "COMMENT_ADDED", `${member.user.name || member.user.email} adicionou um comentário.`);
  } else if (body.action === "status") {
    const status = String(body.status || "");
    const reason = String(body.reason || "").trim();
    if ((status === "BLOCKED" || status === "DISREGARDED") && !reason) {
      return NextResponse.json({ error: "Informe a justificativa." }, { status: 400 });
    }
    await prisma.operationActivity.update({
      where: { id },
      data: {
        status: status as "OPEN" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "DISREGARDED",
        blockedReason: status === "BLOCKED" ? reason : current.blockedReason,
        disregardedReason: status === "DISREGARDED" ? reason : current.disregardedReason,
      },
    });
    await createEvent(id, member.userId, status === "BLOCKED" ? "BLOCKED" : status === "DISREGARDED" ? "DISREGARDED" : "STATUS_CHANGED",
      `${member.user.name || member.user.email} alterou o status para ${status}.`, { reason });
  } else if (body.action === "complete") {
    const result = await finalizeActivity(id, member, String(body.note || ""));
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ activity: result.activity });
  }

  return NextResponse.json({ activity: await prisma.operationActivity.findUnique({ where: { id }, include: activityInclude }) });
}
