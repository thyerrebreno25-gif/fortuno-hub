import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canManageOnboarding,
  getOnboardingMember,
} from "@/modules/onboarding/auth/onboarding-auth";

type Context = { params: Promise<{ id: string }> };

const asDateOnly = (value: unknown) => {
  const text = typeof value === "string" ? value : "";
  const date = new Date(`${text}T12:00:00`);
  if (!text || Number.isNaN(date.getTime())) return null;
  return date;
};

const normalizeProject = (row: any) => {
  const data = row.projectData && typeof row.projectData === "object" ? row.projectData : {};
  return {
    ...data,
    id: row.id,
    companyName: row.companyName ?? data.companyName ?? "",
    tradeName: row.tradeName ?? data.tradeName ?? "",
    cnpj: row.cnpj ?? data.cnpj ?? "",
    contactName: row.contactName ?? data.contactName ?? "",
    contactPhone: row.contactPhone ?? data.contactPhone ?? "",
    contactEmail: row.contactEmail ?? data.contactEmail ?? "",
    supervisor: row.supervisor ?? data.supervisor ?? "",
    analystLead: row.analystLead ?? data.analystLead ?? "",
    team: row.team ?? data.team ?? "",
    responsible: row.responsibleName ?? data.responsible ?? "",
    startDate: row.startDate.toISOString().slice(0, 10),
    expectedEndDate: row.expectedEndDate.toISOString().slice(0, 10),
    status: row.status,
    notes: row.notes ?? data.notes ?? "",
    createdAt: row.createdAt.toISOString(),
  };
};

export async function PUT(request: Request, context: Context) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const { id } = await context.params;
    const body = await request.json();

    const existing = await prisma.onboarding.findFirst({
      where: { id, organizationId: member.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "Implantação não encontrada." }, { status: 404 });

    const startDate = asDateOnly(body.startDate) ?? existing.startDate;
    const expectedEndDate = asDateOnly(body.expectedEndDate) ?? existing.expectedEndDate;
    const status = body.status === "COMPLETED" ? "COMPLETED" : body.status === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN";

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.onboarding.update({
        where: { id },
        data: {
          status,
          completedAt: status === "COMPLETED" ? existing.completedAt ?? new Date() : null,
          startDate,
          expectedEndDate,
          notes: typeof body.notes === "string" ? body.notes.trim() || null : existing.notes,
          companyName: typeof body.companyName === "string" ? body.companyName.trim() : existing.companyName,
          tradeName: typeof body.tradeName === "string" ? body.tradeName.trim() || null : existing.tradeName,
          cnpj: typeof body.cnpj === "string" ? body.cnpj.trim() : existing.cnpj,
          contactName: typeof body.contactName === "string" ? body.contactName.trim() || null : existing.contactName,
          contactPhone: typeof body.contactPhone === "string" ? body.contactPhone.trim() || null : existing.contactPhone,
          contactEmail: typeof body.contactEmail === "string" ? body.contactEmail.trim() || null : existing.contactEmail,
          supervisor: typeof body.supervisor === "string" ? body.supervisor.trim() || null : existing.supervisor,
          analystLead: typeof body.analystLead === "string" ? body.analystLead.trim() || null : existing.analystLead,
          team: typeof body.team === "string" ? body.team.trim() || null : existing.team,
          responsibleName: typeof body.responsible === "string" ? body.responsible.trim() || null : existing.responsibleName,
          projectData: body,
        },
      });

      await tx.onboardingHistory.create({
        data: {
          onboardingId: id,
          userId: member.userId,
          action: "PROJECT_UPDATED",
          entity: "ONBOARDING_PROJECT",
          entityId: id,
          beforeData: existing.projectData ?? undefined,
          afterData: body,
        },
      });
      return updated;
    });

    return NextResponse.json({ project: normalizeProject(row) });
  } catch (error) {
    console.error("Erro ao salvar projeto de onboarding:", error);
    return NextResponse.json({ error: "Não foi possível salvar a implantação." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const member = await getOnboardingMember();
    if (!member) {
      return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    }
    if (!canManageOnboarding(member.role)) {
      return NextResponse.json(
        { error: "Seu perfil não possui permissão para excluir onboardings." },
        { status: 403 },
      );
    }

    const { id } = await context.params;
    const project = await prisma.onboarding.findFirst({
      where: { id, organizationId: member.organizationId },
      select: {
        id: true,
        companyName: true,
        cnpj: true,
        status: true,
        projectData: true,
        _count: { select: { tasks: true, history: true } },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Implantação não encontrada." },
        { status: 404 },
      );
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.auditLog.create({
        data: {
          userId: member.userId,
          action: "ONBOARDING_DELETED",
          entity: "Onboarding",
          entityId: project.id,
          beforeData: {
            companyName: project.companyName,
            cnpj: project.cnpj,
            status: project.status,
            tasks: project._count.tasks,
            historyEntries: project._count.history,
            projectData: project.projectData,
          },
        },
      });
      await transaction.onboarding.delete({ where: { id: project.id } });
    });

    return NextResponse.json({
      message: "Onboarding excluído. O registro da exclusão foi preservado na auditoria.",
    });
  } catch (error) {
    console.error("Erro ao excluir onboarding:", error);
    return NextResponse.json(
      { error: "Não foi possível excluir o onboarding." },
      { status: 500 },
    );
  }
}
