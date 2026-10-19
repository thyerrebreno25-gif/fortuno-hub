import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mappingAccess, mappingFailure, checkMappingClient, MappingError } from "@/modules/operational-mapping/server";
import { organizeMapping, organizeSchema } from "@/modules/operational-mapping/ai";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const { member, permissions } = await mappingAccess();
    if (!permissions.canCreate && !permissions.canEdit) throw new MappingError("Sem permissão para organizar processos.", 403);
    const input = organizeSchema.parse(await request.json());
    await checkMappingClient(member, input.clientId);
    const recent = await prisma.auditLog.count({ where: { userId: member.userId, action: "MAPPING_AI_REQUEST", createdAt: { gte: new Date(Date.now() - 60000) } } });
    if (recent >= 5) throw new MappingError("Aguarde um minuto antes de solicitar outra organização.", 429);
    await prisma.auditLog.create({ data: { userId: member.userId, action: "MAPPING_AI_REQUEST", entity: "OperationalMapping" } });
    return NextResponse.json(await organizeMapping(input));
  } catch (error) { return mappingFailure(error); }
}
