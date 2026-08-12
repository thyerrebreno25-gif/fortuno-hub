import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canManageOperations,
  getOperationMember,
} from "@/modules/operations/auth";

type Context = {
  params: Promise<{ id: string }>;
};

export async function DELETE(
  request: Request,
  context: Context,
) {
  const member = await getOperationMember();

  if (!member) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401 },
    );
  }

  if (!canManageOperations(member.role)) {
    return NextResponse.json(
      {
        error:
          "Seu perfil não possui permissão para excluir rotinas.",
      },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;

  const reason = String(body.reason || "").trim();
  const confirmation = String(
    body.confirmation || "",
  )
    .trim()
    .toUpperCase();

  if (reason.length < 5) {
    return NextResponse.json(
      {
        error:
          "Informe uma justificativa com pelo menos 5 caracteres.",
      },
      { status: 400 },
    );
  }

  if (confirmation !== "EXCLUIR ROTINA") {
    return NextResponse.json(
      {
        error:
          'Digite "EXCLUIR ROTINA" para confirmar a exclusão.',
      },
      { status: 400 },
    );
  }

  const configuration =
    await prisma.operationClientProcess.findFirst({
      where: {
        id,
        client: {
          organizationId: member.organizationId,
        },
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
          },
        },
        process: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

  if (!configuration) {
    return NextResponse.json(
      { error: "Rotina não encontrada." },
      { status: 404 },
    );
  }

  const now = new Date();

  const activities =
    await prisma.operationActivity.findMany({
      where: {
        clientProcessId: configuration.id,
        organizationId: member.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

  await prisma.$transaction(async (tx) => {
    /*
     * Encerra cronômetros eventualmente abertos antes de remover
     * as atividades da rotina da agenda.
     */
    for (const activity of activities) {
      const openEntries =
        await tx.operationTimeEntry.findMany({
          where: {
            activityId: activity.id,
            endedAt: null,
          },
          select: {
            id: true,
            startedAt: true,
          },
        });

      for (const entry of openEntries) {
        await tx.operationTimeEntry.update({
          where: {
            id: entry.id,
          },
          data: {
            endedAt: now,
            seconds: Math.max(
              1,
              Math.floor(
                (now.getTime() -
                  entry.startedAt.getTime()) /
                  1000,
              ),
            ),
          },
        });
      }

      await tx.operationEvent.create({
        data: {
          activityId: activity.id,
          userId: member.userId,
          type: "ACTIVITY_DELETED",
          message: `${
            member.user.name || member.user.email
          } excluiu a atividade ao remover a rotina completa.`,
          metadata: {
            reason,
            routineId: configuration.id,
            routineClient: configuration.client.name,
            routineProcess: configuration.process.name,
          },
        },
      });
    }

    /*
     * As atividades são soft-delete para preservar histórico,
     * checklist, comentários, anexos e eventos.
     */
    if (activities.length) {
      await tx.operationActivity.updateMany({
        where: {
          id: {
            in: activities.map(
              (activity) => activity.id,
            ),
          },
        },
        data: {
          deletedAt: now,
          deletedById: member.userId,
          deletionReason: `Rotina excluída: ${reason}`,
        },
      });
    }

    /*
     * Remove a configuração da rotina.
     *
     * OperationActivity.clientProcess usa onDelete: SetNull,
     * então os registros históricos permanecem preservados.
     * Se a mesma rotina for criada futuramente, ela recebe uma
     * nova configuração e não conflita com as datas antigas.
     */
    await tx.operationClientProcess.delete({
      where: {
        id: configuration.id,
      },
    });
  });

  return NextResponse.json({
    message: "Rotina excluída com sucesso.",
    routine: {
      client: configuration.client.name,
      process: configuration.process.name,
    },
    removedActivities: activities.length,
  });
}
