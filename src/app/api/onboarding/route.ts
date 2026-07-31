import { NextResponse } from "next/server";
import { getOnboardingMember, canManageOnboarding } from "@/modules/onboarding/auth/onboarding-auth";
import { onboardingService } from "@/modules/onboarding/services/onboarding.service";

export async function GET() {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    return NextResponse.json({ onboardings: await onboardingService.list(member.organizationId) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível carregar os onboardings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    if (!canManageOnboarding(member.role)) return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
    const body = await request.json();
    if (!body.clientId || !body.templateId || !body.startDate) {
      return NextResponse.json({ error: "Cliente, template e data de início são obrigatórios." }, { status: 400 });
    }
    const onboarding = await onboardingService.create(member.organizationId, member.userId, body);
    return NextResponse.json({ onboarding }, { status: 201 });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    if (message === "CLIENT_NOT_FOUND") return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    if (message === "TEMPLATE_NOT_FOUND") return NextResponse.json({ error: "Template não encontrado." }, { status: 404 });
    return NextResponse.json({ error: "Não foi possível criar o onboarding." }, { status: 500 });
  }
}
