import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assistantClientAccessWhere } from "@/modules/assistant/auth";
import { mappingInputSchema } from "@/modules/operational-mapping/model";
import { mappingAccess, mappingScope, mappingFailure, checkMappingClient, MappingError } from "@/modules/operational-mapping/server";
export async function GET(request: Request) {
  try {
    const { member, permissions } = await mappingAccess();
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const mapping = await prisma.operationalMapping.findFirst({ where: { id, ...mappingScope(member) }, include: { client: { select: { name: true } } } });
      if (!mapping) throw new MappingError("Mapeamento não encontrado.", 404);
      return NextResponse.json({ mapping });
    }
    const [mappings, clients] = await Promise.all([
      prisma.operationalMapping.findMany({ where: mappingScope(member), orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, title: true, clientId: true, owner: true, status: true, updatedAt: true, revision: true, client: { select: { name: true } } } }),
      prisma.client.findMany({ where: { organizationId: member.organizationId, active: true, ...assistantClientAccessWhere(member) }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);
    return NextResponse.json({ mappings, clients, permissions, aiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) });
  } catch (error) { return mappingFailure(error); }
}
export async function POST(request: Request) {
  try {
    const { member } = await mappingAccess("canCreate");
    const input = mappingInputSchema.parse(await request.json());
    await checkMappingClient(member, input.clientId);
    const mapping = await prisma.operationalMapping.create({ data: { ...input, organizationId: member.organizationId, createdById: member.userId }, include: { client: { select: { name: true } } } });
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) { return mappingFailure(error); }
}
export async function PATCH(request: Request) {
  try {
    const { member } = await mappingAccess("canEdit");
    const body = await request.json();
    const { id, revision } = z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive() }).parse(body);
    const input = mappingInputSchema.parse(body);
    await checkMappingClient(member, input.clientId);
    const mapping = await prisma.$transaction(async (tx) => {
      const result = await tx.operationalMapping.updateMany({ where: { id, revision, ...mappingScope(member) }, data: { ...input, revision: { increment: 1 } } });
      if (!result.count) throw new MappingError("Este mapeamento foi alterado por outra pessoa ou não está mais disponível. Reabra-o na central antes de salvar.", 409);
      return tx.operationalMapping.findUniqueOrThrow({ where: { id }, include: { client: { select: { name: true } } } });
    });
    return NextResponse.json({ mapping });
  } catch (error) { return mappingFailure(error); }
}
