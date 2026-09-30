import { NextResponse } from "next/server";
import { canSuperviseAudit, getAuditMember } from "@/modules/audit/auth";
import { parseSalesWorkbook } from "@/modules/sales-reconciliation/workbook-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const member = await getAuditMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canSuperviseAudit(member.role, member.isTeamLeader)) {
    return NextResponse.json({ error: "Apenas líderes podem iniciar esta conferência." }, { status: 403 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecione uma planilha Excel." }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "A planilha deve ter no máximo 15 MB." }, { status: 400 });
    }
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      return NextResponse.json({ error: "Envie um arquivo .xlsx ou .xls." }, { status: 400 });
    }
    return NextResponse.json(await parseSalesWorkbook(file));
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Não foi possível ler a planilha.",
    }, { status: 400 });
  }
}
