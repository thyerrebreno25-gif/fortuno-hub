import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOnboarding, getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

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

export async function GET() {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

    const templates = await prisma.onboardingTemplate.findMany({
      where: { organizationId: member.organizationId },
      orderBy: [{ active: "desc" }, { isDefault: "desc" }, { name: "asc" }],
      include: includeStructure,
    });

    return NextResponse.json({ templates });
  } catch (error) {
    console.error("Erro ao listar templates:", error);
    return NextResponse.json({ error: "Não foi possível carregar os templates." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "Novo template";
    const description = typeof body.description === "string" ? body.description.trim() : "Modelo editável de onboarding.";
    const slaDays = Number.isFinite(Number(body.slaDays)) ? Math.max(1, Number(body.slaDays)) : 30;

    const template = await prisma.onboardingTemplate.create({
      data: {
        organizationId: member.organizationId,
        name,
        description,
        slaDays,
        active: true,
        isDefault: false,
        categories: {
          create: [
            {
              name: "Nova categoria",
              description: "Organize aqui uma etapa principal do onboarding.",
              position: 1,
              activities: {
                create: [
                  {
                    name: "Nova atividade",
                    description: "Agrupe tarefas relacionadas.",
                    position: 1,
                    tasks: {
                      create: [
                        {
                          subcategory: "Subcategoria",
                          title: "Nova tarefa",
                          description: "Edite esta tarefa conforme o processo.",
                          mandatory: true,
                          estimatedMinutes: 30,
                          position: 1,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      include: includeStructure,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar template:", error);
    return NextResponse.json({ error: "Não foi possível criar o template. Verifique se o nome já existe." }, { status: 500 });
  }
}
