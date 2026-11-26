import {randomBytes} from "node:crypto";
import {NextResponse} from "next/server";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "@/modules/management/operator-report-server";
import {executiveReportData} from "@/modules/management/executive-report-model";
import {executiveDashboardHtml} from "@/modules/management/executive-report-html";
export const maxDuration=60;
export async function GET(request:Request){
 const member=await getMemberForModule("MANAGEMENT");if(!member||!["MASTER","ADMIN","MANAGER"].includes(member.role))return NextResponse.json({error:"Sem acesso ao relatório."},{status:403});
 const permissions=await getRolePermissions(member.organizationId,member.role);if(!permissions.MANAGEMENT.canExport)return NextResponse.json({error:"Sem permissão para exportar."},{status:403});
 try{const query=new URL(request.url).searchParams,kind=query.get("kind")==="SERVICE"?"SERVICE":"GENERAL",report=await buildOperatorDayReport(member,query.get("day")||undefined,new Date(),kind);return new Response(executiveDashboardHtml(executiveReportData(report),randomBytes(18).toString("base64url")),{headers:{"Content-Type":"text/html; charset=utf-8","Content-Disposition":`attachment; filename="Fortuno-Dashboard-${kind}-${report.day}.html"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}catch{return NextResponse.json({error:"Não foi possível gerar o dashboard."},{status:503});}
}
