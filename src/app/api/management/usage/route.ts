import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getCurrentMember, getRolePermissions } from "@/modules/permissions/permissions";
import { managementRole } from "@/modules/executive/model";
import { usagePeriod } from "@/modules/usage/model";
import { usagePages } from "@/modules/usage/catalog";
import { usageSnapshot } from "@/modules/usage/server";
export async function GET(request: Request) {
  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  const permissions = await getRolePermissions(member.organizationId, member.role);
  if (!managementRole(member.role) || !permissions.MANAGEMENT.canView) return NextResponse.json({ error: "Análise de uso restrita à gestão." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  let period: ReturnType<typeof usagePeriod>;
  try { period = usagePeriod(params.get("from"), params.get("to")); } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  const filters = { userId: params.get("userId") || undefined, clientId: params.get("clientId") || undefined, pageKey: params.get("pageKey") || undefined };
  if ((filters.userId?.length || 0) > 100 || (filters.clientId?.length || 0) > 100 || (filters.clientId && !permissions.CLIENTS.canView) || (filters.pageKey && !usagePages.some(p => p.key === filters.pageKey && permissions[p.module].canView))) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  try {
    const bucket = String(Math.floor(Date.now() / 300000));
    const data = await unstable_cache(() => usageSnapshot(member.organizationId, period, permissions, filters), ["hub-usage-v2", member.organizationId, period.from, period.to, JSON.stringify(filters), JSON.stringify(permissions), bucket], { revalidate: 300 })();
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { console.error("Falha na análise de uso", error instanceof Error ? error.name : "unknown"); return NextResponse.json({ error: "Não foi possível consultar o uso da ferramenta. Tente novamente." }, { status: 503 }); }
}
