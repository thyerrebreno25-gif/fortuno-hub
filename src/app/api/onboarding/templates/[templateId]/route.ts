import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOnboarding, getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

type Context = { params: Promise<{ templateId: string }> };

const includeStructure = {
  categories: {
    orderBy: { position: "asc" as const },
    include: {
      activities: {
        orderBy: { position: "asc" as const },
        include: { tasks: { orderBy: { position: "asc" as const } } },
      },
    },
  },
} as const;

export async function GET(_: Request, context: Context) {
  const member = await getOnboardingMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const { templateId } = await context.params;
  const template = await prisma.onboardingTemplate.findFirst({
    where: { id: templateId, organizationId: member.organizationId },
    include: includeStructure,
  });
  if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
  return NextResponse.json({ template });
}

export async function PUT(request: Request, context: Context) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    const { templateId } = await context.params;
    const body = await request.json();
    const existing = await prisma.onboardingTemplate.findFirst({
      where: { id: templateId, organizationId: member.organizationId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

    if (!Array.isArray(body.categories)) {
      return NextResponse.json({ error: "A estrutura de categorias é inválida." }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 3) return NextResponse.json({ error: "Informe um nome válido." }, { status: 400 });

    const template = await prisma.$transaction(async (tx) => {
      if (body.isDefault === true) {
        await tx.onboardingTemplate.updateMany({
          where: { organizationId: member.organizationId, id: { not: templateId } },
          data: { isDefault: false },
        });
      }

      await tx.onboardingTemplateCategory.deleteMany({ where: { templateId } });

      return tx.onboardingTemplate.update({
        where: { id: templateId },
        data: {
          name,
          description: typeof body.description === "string" ? body.description.trim() : null,
          slaDays: Math.max(1, Number(body.slaDays) || 30),
          active: body.active !== false,
          isDefault: body.isDefault === true,
          categories: {
            create: body.categories.map((category: any, categoryIndex: number) => ({
              name: String(category.name || `Categoria ${categoryIndex + 1}`).trim(),
              description: category.description ? String(category.description).trim() : null,
              position: categoryIndex + 1,
              activities: {
                create: (Array.isArray(category.activities) ? category.activities : []).map((activity: any, activityIndex: number) => ({
                  name: String(activity.name || `Atividade ${activityIndex + 1}`).trim(),
                  description: activity.description ? String(activity.description).trim() : null,
                  position: activityIndex + 1,
                  tasks: {
                    create: (Array.isArray(activity.tasks) ? activity.tasks : []).map((task: any, taskIndex: number) => ({
                      subcategory: String(task.subcategory || "Geral").trim(),
                      title: String(task.title || `Tarefa ${taskIndex + 1}`).trim(),
                      description: task.description ? String(task.description).trim() : null,
                      defaultResponsibleRole: task.defaultResponsibleRole ? String(task.defaultResponsibleRole).trim() : null,
                      mandatory: task.mandatory !== false,
                      estimatedMinutes: Math.max(0, Number(task.estimatedMinutes) || 0),
                      tip: task.tip ? String(task.tip).trim() : null,
                      isNotionReminder: task.isNotionReminder === true,
                      position: taskIndex + 1,
                    })),
                  },
                })),
              },
            })),
          },
        },
        include: includeStructure,
      });
    });

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Erro ao salvar template:", error);
    return NextResponse.json({ error: "Não foi possível salvar o template." }, { status: 500 });
  }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    const { templateId } = await context.params;

    const template = await prisma.onboardingTemplate.findFirst({
      where: { id: templateId, organizationId: member.organizationId },
      select: { id: true, _count: { select: { onboardings: true } } },
    });
    if (!template) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

    if (template._count.onboardings > 0) {
      await prisma.onboardingTemplate.update({ where: { id: templateId }, data: { active: false, isDefault: false } });
      return NextResponse.json({ archived: true });
    }

    await prisma.onboardingTemplate.delete({ where: { id: templateId } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Erro ao excluir template:", error);
    return NextResponse.json({ error: "Não foi possível excluir o template." }, { status: 500 });
  }
}
