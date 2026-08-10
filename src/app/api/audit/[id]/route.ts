import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  canSuperviseAudit,
  getAuditMember,
} from "@/modules/audit/auth";

type Context = {
  params: Promise<{ id: string }>;
};

export async function DELETE(
  _request: Request,
  context: Context,
) {
  const member = await getAuditMember();

  if (!member) {
    return NextResponse.json(
      { error: "Sessão inválida." },
      { status: 401 },
    );
  }

  if (!canSuperviseAudit(member.role)) {
    return NextResponse.json(
      {
        error:
          "Apenas supervisores podem excluir auditorias.",
      },
      { status: 403 },
    );
  }

  const { id } = await context.params;

  const audit = await prisma.audit.findFirst({
    where: {
      id,
      organizationId: member.organizationId,
    },
    select: {
      id: true,
      client: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!audit) {
    return NextResponse.json(
      { error: "Auditoria não encontrada." },
      { status: 404 },
    );
  }

  /*
   * AuditFile, AuditFinding, AuditInteraction e AuditChecklistItem
   * possuem relacionamento em cascata com Audit/AuditFinding.
   * Portanto a exclusão do registro raiz remove todo o fluxo
   * relacionado, inclusive pendências que apareciam ao operador.
   */
  await prisma.audit.delete({
    where: {
      id: audit.id,
    },
  });

  return NextResponse.json({
    message: "Auditoria excluída com sucesso.",
    id: audit.id,
    clientName: audit.client.name,
  });
}
