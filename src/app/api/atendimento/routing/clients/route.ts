import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember } from "@/modules/atendimento/auth";
import { getRolePermissions } from "@/modules/permissions/permissions";

export async function GET() {
  const member = await getServiceCenterMember();

  if (!member) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401 },
    );
  }

  const permissions = await getRolePermissions(
    member.organizationId,
    member.role,
  );

  if (!permissions.CLIENTS.canView) {
    return NextResponse.json(
      { error: "Sem permissão para visualizar clientes." },
      { status: 403 },
    );
  }

  const [clients, members] = await Promise.all([
    prisma.client.findMany({
      where: {
        organizationId: member.organizationId,
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        document: true,
        operationalEmail: true,
        operationalEmailCc: true,
        operationLeaderId: true,
        serviceSquad: true,
        payableResponsibleId: true,
        receivableResponsibleId: true,
        generalResponsibleId: true,
        serviceAliases: true,
        operationLeader: {
          select: { id: true, name: true, email: true },
        },
        payableResponsible: {
          select: { id: true, name: true, email: true },
        },
        receivableResponsible: {
          select: { id: true, name: true, email: true },
        },
        generalResponsible: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
    prisma.organizationMember.findMany({
      where: {
        organizationId: member.organizationId,
        role: { not: "CLIENT" },
      },
      orderBy: { user: { name: "asc" } },
      select: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
  ]);

  return NextResponse.json({
    clients,
    members: members.map((item) => item.user),
  });
}

export async function PATCH(request: Request) {
  const member = await getServiceCenterMember();

  if (!member) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401 },
    );
  }

  const permissions = await getRolePermissions(
    member.organizationId,
    member.role,
  );

  if (!permissions.CLIENTS.canEdit) {
    return NextResponse.json(
      { error: "Sem permissão para alterar o roteamento." },
      { status: 403 },
    );
  }

  const body = await request.json();
  const clientId = String(body.clientId || "");

  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId: member.organizationId,
    },
    select: { id: true },
  });

  if (!client) {
    return NextResponse.json(
      { error: "Cliente não encontrado." },
      { status: 404 },
    );
  }

  const validMemberIds = new Set(
    (
      await prisma.organizationMember.findMany({
        where: {
          organizationId: member.organizationId,
          role: { not: "CLIENT" },
        },
        select: { userId: true },
      })
    ).map((item) => item.userId),
  );

  const responsibleFields = [
    body.operationLeaderId,
    body.payableResponsibleId,
    body.receivableResponsibleId,
    body.generalResponsibleId,
  ].filter(Boolean);

  if (
    responsibleFields.some(
      (id) => !validMemberIds.has(String(id)),
    )
  ) {
    return NextResponse.json(
      { error: "Um dos responsáveis não pertence à organização." },
      { status: 400 },
    );
  }

  const serviceSquad =
    body.serviceSquad === "SQUAD_1" ||
    body.serviceSquad === "SQUAD_2"
      ? body.serviceSquad
      : null;

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: {
      operationLeaderId: body.operationLeaderId || null,
      serviceSquad,
      payableResponsibleId: body.payableResponsibleId || null,
      receivableResponsibleId: body.receivableResponsibleId || null,
      generalResponsibleId: body.generalResponsibleId || null,
      serviceAliases: String(body.serviceAliases || "").trim() || null,
    },
  });

  return NextResponse.json({
    message: "Roteamento do cliente atualizado.",
    client: updated,
  });
}
