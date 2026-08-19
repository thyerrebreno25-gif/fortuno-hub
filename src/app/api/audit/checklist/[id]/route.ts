import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canSuperviseAudit,
  getAuditMember,
  isAuditAdministrator,
} from "@/modules/audit/auth";

type Context = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUS = new Set([
  "COMPLIANT",
  "NON_COMPLIANT",
  "NOT_APPLICABLE",
]);

export async function PATCH(
  request: Request,
  context: Context,
) {
  const member = await getAuditMember();

  if (!member) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401 },
    );
  }

  if (!canSuperviseAudit(member.role, member.isTeamLeader)) {
    return NextResponse.json(
      { error: "Apenas líderes podem revisar o checklist." },
      { status: 403 },
    );
  }

  const { id } = await context.params;
  const body = await request.json();

  const status = String(body.status || "").toUpperCase();
  const note =
    typeof body.note === "string" ? body.note.trim() : "";
  const operatorId =
    typeof body.operatorId === "string"
      ? body.operatorId.trim()
      : "";
  const dueAt =
    typeof body.dueAt === "string" && body.dueAt
      ? new Date(`${body.dueAt}T23:59:59`)
      : null;

  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json(
      { error: "Resultado do checklist inválido." },
      { status: 400 },
    );
  }

  const checklist = await prisma.auditChecklistItem.findFirst({
    where: {
      id,
      audit: {
        organizationId: member.organizationId,
      },
    },
    include: {
      audit: {
        select: {
          id: true,
          organizationId: true,
          clientId: true,
          supervisorId: true,
        },
      },
    },
  });

  if (!checklist) {
    return NextResponse.json(
      { error: "Item do checklist não encontrado." },
      { status: 404 },
    );
  }

  const administrator = isAuditAdministrator(member.role);
  if (
    !administrator &&
    checklist.audit.supervisorId !== member.userId
  ) {
    return NextResponse.json(
      { error: "Somente o líder responsável pode revisar este checklist." },
      { status: 403 },
    );
  }

  if (status === "NON_COMPLIANT") {
    if (!note) {
      return NextResponse.json(
        {
          error:
            "Informe a orientação do líder antes de enviar para correção.",
        },
        { status: 400 },
      );
    }

    if (!operatorId) {
      return NextResponse.json(
        { error: "Selecione o operador responsável." },
        { status: 400 },
      );
    }

    if (!dueAt) {
      return NextResponse.json(
        { error: "Defina o prazo da correção." },
        { status: 400 },
      );
    }

    const operator =
      await prisma.organizationMember.findFirst({
        where: {
          organizationId: member.organizationId,
          userId: operatorId,
          role: "OPERATOR",
          isTeamLeader: false,
          ...(member.isTeamLeader && !administrator
            ? { teamLeaderId: member.id }
            : {}),
        },
        select: {
          userId: true,
        },
      });

    if (!operator) {
      return NextResponse.json(
        { error: "Selecione um operador vinculado à equipe deste líder." },
        { status: 400 },
      );
    }
  }

  const ruleCode = `CHECKLIST:${checklist.id}`;

  const result = await prisma.$transaction(async (tx) => {
    const reviewed = await tx.auditChecklistItem.update({
      where: {
        id: checklist.id,
      },
      data: {
        status: status as
          | "COMPLIANT"
          | "NON_COMPLIANT"
          | "NOT_APPLICABLE",
        note: note || null,
        reviewedById: member.userId,
        reviewedAt: new Date(),
      },
    });

    const existingFinding = await tx.auditFinding.findFirst({
      where: {
        auditId: checklist.auditId,
        ruleCode,
      },
    });

    let finding = existingFinding;

    if (status === "NON_COMPLIANT") {
      const findingData = {
        source: "SUPERVISOR_CHECKLIST" as const,
        ruleCode,
        title: `${checklist.category} — Não conformidade`,
        description: checklist.title,
        severity: "WARNING" as const,
        subject: checklist.title,
        category: checklist.category,
        operatorId,
        supervisorNote: note,
        dueAt,
        status: "SENT" as const,
        sentAt: new Date(),
        validatedAt: null,
        completedAt: null,
      };

      if (existingFinding) {
        finding = await tx.auditFinding.update({
          where: {
            id: existingFinding.id,
          },
          data: findingData,
        });

        await tx.auditInteraction.create({
          data: {
            findingId: existingFinding.id,
            userId: member.userId,
            action: "CHECKLIST_REVIEW_UPDATED",
            note,
            metadata: {
              checklistItemId: checklist.id,
              status,
            },
          },
        });
      } else {
        finding = await tx.auditFinding.create({
          data: {
            auditId: checklist.auditId,
            ...findingData,
            evidence: {
              origin: "CHECKLIST_SUPERVISOR",
              checklistItemId: checklist.id,
              checklistCategory: checklist.category,
              checklistTitle: checklist.title,
            },
          },
        });

        await tx.auditInteraction.create({
          data: {
            findingId: finding.id,
            userId: member.userId,
            action: "ASSIGN",
            note,
            metadata: {
              origin: "CHECKLIST_SUPERVISOR",
              checklistItemId: checklist.id,
            },
          },
        });
      }
    } else if (
      existingFinding &&
      !["VALIDATED", "DISMISSED"].includes(existingFinding.status)
    ) {
      finding = await tx.auditFinding.update({
        where: {
          id: existingFinding.id,
        },
        data: {
          status: "DISMISSED",
        },
      });

      await tx.auditInteraction.create({
        data: {
          findingId: existingFinding.id,
          userId: member.userId,
          action: "CHECKLIST_RECLASSIFIED",
          note:
            note ||
            `Checklist alterado para ${status}. O report anterior foi encerrado.`,
          metadata: {
            checklistItemId: checklist.id,
            status,
          },
        },
      });
    }

    const [
      pendingChecklist,
      unresolvedFindings,
      sentFindings,
      pendingValidation,
    ] = await Promise.all([
      tx.auditChecklistItem.count({
        where: {
          auditId: checklist.auditId,
          status: "PENDING",
        },
      }),
      tx.auditFinding.count({
        where: {
          auditId: checklist.auditId,
          status: {
            notIn: ["VALIDATED", "DISMISSED"],
          },
        },
      }),
      tx.auditFinding.count({
        where: {
          auditId: checklist.auditId,
          status: {
            in: [
              "SENT",
              "IN_PROGRESS",
              "RETURNED",
            ],
          },
        },
      }),
      tx.auditFinding.count({
        where: {
          auditId: checklist.auditId,
          status: "PENDING_VALIDATION",
        },
      }),
    ]);

    let auditStatus:
      | "IN_REVIEW"
      | "SENT_TO_CORRECTION"
      | "PENDING_VALIDATION"
      | "COMPLETED" = "IN_REVIEW";

    if (
      pendingChecklist === 0 &&
      unresolvedFindings === 0
    ) {
      auditStatus = "COMPLETED";
    } else if (pendingValidation > 0) {
      auditStatus = "PENDING_VALIDATION";
    } else if (sentFindings > 0) {
      auditStatus = "SENT_TO_CORRECTION";
    }

    await tx.audit.update({
      where: {
        id: checklist.auditId,
      },
      data: {
        status: auditStatus,
        completedAt:
          auditStatus === "COMPLETED"
            ? new Date()
            : null,
      },
    });

    return {
      checklist: reviewed,
      finding,
    };
  });

  return NextResponse.json(result);
}
