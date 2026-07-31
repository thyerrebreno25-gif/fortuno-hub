import { NextResponse } from "next/server";
import { getOnboardingMember } from "@/modules/onboarding/auth/onboarding-auth";
import { onboardingService } from "@/modules/onboarding/services/onboarding.service";

export async function GET() {
  try {
    const member = await getOnboardingMember();
    if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    return NextResponse.json(await onboardingService.dashboard(member.organizationId));
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Não foi possível carregar o dashboard." }, { status: 500 });
  }
}
