import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getCurrentMember, getRolePermissions } from "@/modules/permissions/permissions";
import { usagePages } from "@/modules/usage/catalog";
import { assistantClientAccessWhere, type AssistantMember } from "@/modules/assistant/auth";

const input = z.object({ id: z.uuid(), pageKey: z.string().max(40), clientId: z.string().min(1).max(100).nullable(), activeSeconds: z.number().int().min(0).max(43200) }).strict();
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
    if (Number(request.headers.get("content-length")) > 1024) return new Response(null, { status: 413 });
    const member = await getCurrentMember();
    if (!member || member.role === "CLIENT") return new Response(null, { status: 403 });
    const parsed = input.safeParse(await request.json());
    if (!parsed.success) return new Response(null, { status: 400 });
    const body = parsed.data, page = usagePages.find(p => p.key === body.pageKey);
    const permissions = await getRolePermissions(member.organizationId, member.role);
    if (!page || !permissions[page.module]?.canView) return new Response(null, { status: 403 });
    if (body.clientId) {
      const team = member.isTeamLeader ? await prisma.organizationMember.findMany({ where: { organizationId: member.organizationId, teamLeaderId: member.id }, select: { userId: true } }) : [];
      const scope = assistantClientAccessWhere({ ...member, teamMemberUserIds: team.map(p => p.userId) } as AssistantMember);
      if (!await prisma.client.findFirst({ where: { id: body.clientId, organizationId: member.organizationId, ...scope }, select: { id: true } })) return new Response(null, { status: 404 });
    }
    // Same UUID retries only raise a cumulative counter. Neither identity nor scope comes from the browser.
    const saved = await prisma.$queryRaw<Array<{id: string}>>(Prisma.sql`
      INSERT INTO "HubUsageSession" (id,"organizationId","userId","pageKey","clientId","activeSeconds","startedAt","lastSeenAt")
      SELECT ${body.id},${member.organizationId},${member.userId},${body.pageKey},${body.clientId},LEAST(${body.activeSeconds},15),timezone('UTC',CURRENT_TIMESTAMP),timezone('UTC',CURRENT_TIMESTAMP)
      WHERE EXISTS(SELECT 1 FROM "HubUsageSession" WHERE id=${body.id}) OR (SELECT COUNT(*) FROM "HubUsageSession" WHERE "organizationId"=${member.organizationId} AND "userId"=${member.userId} AND "startedAt">CURRENT_TIMESTAMP-INTERVAL '1 minute') < 40
      ON CONFLICT(id) DO UPDATE SET "activeSeconds"=GREATEST("HubUsageSession"."activeSeconds",LEAST(${body.activeSeconds},43200,GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (timezone('UTC',CURRENT_TIMESTAMP)-"HubUsageSession"."startedAt"))))::int+15)),"lastSeenAt"=timezone('UTC',CURRENT_TIMESTAMP)
      WHERE "HubUsageSession"."organizationId"=${member.organizationId} AND "HubUsageSession"."userId"=${member.userId} AND "HubUsageSession"."pageKey"=${body.pageKey} AND "HubUsageSession"."clientId" IS NOT DISTINCT FROM ${body.clientId}
      RETURNING id`);
    return new Response(null, { status: saved.length ? 204 : 409, headers: { "Cache-Control": "private, no-store" } });
  } catch { return new Response(null, { status: 503 }); }
}
