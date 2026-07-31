import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageOnboarding, getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";

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

export async function GET() {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });

    const rows = await prisma.onboarding.findMany({
  where: {
    organizationId: member.organizationId,
    NOT: {
      projectData: {
        equals: Prisma.AnyNull,
      },
    },
  },
  orderBy: [
    { status: "asc" },
    { createdAt: "desc" },
  ],
});

    return NextResponse.json({ projects: rows.map(normalizeProject) });
  } catch (error) {
    console.error("Erro ao carregar projetos de onboarding:", error);
    return NextResponse.json({ error: "Não foi possível carregar as implantações." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });

    const body = await request.json();
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
    const cnpj = typeof body.cnpj === "string" ? body.cnpj.trim() : "";
    const startDate = asDateOnly(body.startDate);
    const expectedEndDate = asDateOnly(body.expectedEndDate);

    if (!companyName || !cnpj || !startDate || !expectedEndDate || !body.supervisor || !body.analystLead || !body.team) {
      return NextResponse.json({ error: "Preencha os dados obrigatórios da implantação." }, { status: 400 });
    }

    const duplicate = await prisma.onboarding.findFirst({
      where: {
        organizationId: member.organizationId,
        cnpj,
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: "Já existe uma implantação ativa para este CNPJ." }, { status: 409 });
    }

    const row = await prisma.onboarding.create({
      data: {
        organizationId: member.organizationId,
        createdById: member.userId,
        status: body.status === "IN_PROGRESS" ? "IN_PROGRESS" : "OPEN",
        startDate,
        expectedEndDate,
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        companyName,
        tradeName: typeof body.tradeName === "string" ? body.tradeName.trim() || null : null,
        cnpj,
        contactName: typeof body.contactName === "string" ? body.contactName.trim() || null : null,
        contactPhone: typeof body.contactPhone === "string" ? body.contactPhone.trim() || null : null,
        contactEmail: typeof body.contactEmail === "string" ? body.contactEmail.trim() || null : null,
        supervisor: String(body.supervisor).trim(),
        analystLead: String(body.analystLead).trim(),
        team: String(body.team).trim(),
        responsibleName: typeof body.responsible === "string" ? body.responsible.trim() || null : null,
        projectData: body,
        history: { create: { userId: member.userId, action: "CREATED", entity: "ONBOARDING_PROJECT" } },
      },
    });

    return NextResponse.json({ project: normalizeProject(row) }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar projeto de onboarding:", error);
    return NextResponse.json({ error: "Não foi possível criar a implantação." }, { status: 500 });
  }
}
