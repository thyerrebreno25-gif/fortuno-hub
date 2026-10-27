import { after, NextResponse } from "next/server";
import { assistantClientAccessWhere, getMemberForModule } from "@/modules/assistant/auth";
import { runManagementSync } from "@/modules/management/sync";
export const maxDuration = 300;
export async function POST() {
  const member = await getMemberForModule("MANAGEMENT");
  if (!member || member.role === "CLIENT") return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  const scope = { organizationId: member.organizationId, ...assistantClientAccessWhere(member) };
  after(async () => { await runManagementSync(scope); });
  return NextResponse.json({ accepted: true, intervalMinutes: 15 }, { status: 202 });
}
