import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOnboarding, getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

type Context = { params: Promise<{ templateId: string }> };

export async function POST(_: Request, context: Context) {
  const member = await getOnboardingMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  const { templateId } = await context.params;

  const source = await prisma.onboardingTemplate.findFirst({
    where: { id: templateId, organizationId: member.organizationId },
    include: { categories: { orderBy: { position: "asc" }, include: { activities: { orderBy: { position: "asc" }, include: { tasks: { orderBy: { position: "asc" } } } } } } },
  });
  if (!source) return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });

  let name = `${source.name} — Cópia`;
  let suffix = 2;
  while (await prisma.onboardingTemplate.findFirst({ where: { organizationId: member.organizationId, name } })) {
    name = `${source.name} — Cópia ${suffix++}`;
  }

  const template = await prisma.onboardingTemplate.create({
    data: {
      organizationId: member.organizationId,
      name,
      description: source.description,
      slaDays: source.slaDays,
      active: true,
      isDefault: false,
      categories: { create: source.categories.map((category) => ({
        name: category.name, description: category.description, position: category.position,
        activities: { create: category.activities.map((activity) => ({
          name: activity.name, description: activity.description, position: activity.position,
          tasks: { create: activity.tasks.map((task) => ({
            subcategory: task.subcategory, title: task.title, description: task.description,
            defaultResponsibleRole: task.defaultResponsibleRole, mandatory: task.mandatory,
            estimatedMinutes: task.estimatedMinutes, tip: task.tip,
            isNotionReminder: task.isNotionReminder, position: task.position,
          })) },
        })) },
      })) },
    },
  });

  return NextResponse.json({ template }, { status: 201 });
}
