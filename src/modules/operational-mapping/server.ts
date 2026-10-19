import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMappingMember, assistantClientAccessWhere, hasOrganizationClientScope, type AssistantMember } from "@/modules/assistant/auth";
import { getRolePermissions, type PermissionShape } from "@/modules/permissions/permissions";
import { ZodError } from "zod";
import { MappingError } from "./errors";
export { MappingError } from "./errors";
export async function mappingAccess(action: keyof PermissionShape = "canView") {
  const member = await getMappingMember();
  if (!member) throw new MappingError("Sessão inválida ou acesso não autorizado.", 401);
  const permissions = (await getRolePermissions(member.organizationId, member.role)).OPERATIONAL_MAPPING;
  if (!permissions[action]) throw new MappingError("Seu perfil não permite esta ação.", 403);
  return { member, permissions };
}
export function mappingScope(member: AssistantMember) {
  return { organizationId: member.organizationId, ...(hasOrganizationClientScope(member) ? {} : { OR: [
    { client: { is: { organizationId: member.organizationId, ...assistantClientAccessWhere(member) } } },
    { clientId: null, createdById: member.userId },
  ] }) };
}
export async function checkMappingClient(member: AssistantMember, clientId: string | null) {
  if (clientId && !await prisma.client.findFirst({ where: { id: clientId, organizationId: member.organizationId, active: true, ...assistantClientAccessWhere(member) }, select: { id: true } })) throw new MappingError("Cliente indisponível para sua conta.", 403);
}
export function mappingFailure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Dados inválidos." }, { status: 400 });
  if (error instanceof MappingError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Falha no mapeamento operacional", error instanceof Error ? error.name : "Unknown");
  return NextResponse.json({ error: "Não foi possível concluir a operação. Tente novamente." }, { status: 500 });
}
