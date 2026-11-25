import {NextResponse} from "next/server";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "@/modules/management/operator-report-server";
import {reportPeriod} from "@/modules/management/operator-report-model";
import {createOperatorReportPdf,operatorPdfName} from "@/modules/management/operator-report-pdf";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 const member=await getMemberForModule("MANAGEMENT");if(!member||!["MASTER","ADMIN","MANAGER"].includes(member.role))return NextResponse.json({error:"Sem acesso ao relatório."},{status:403});
 const permissions=await getRolePermissions(member.organizationId,member.role);if(!permissions.MANAGEMENT.canExport)return NextResponse.json({error:"Sem permissão para exportar o relatório."},{status:403});
 const day=new URL(request.url).searchParams.get("day")||undefined;try{reportPeriod(day);}catch{return NextResponse.json({error:"Selecione um dia anterior a hoje."},{status:400});}
 try{const report=await buildOperatorDayReport(member,day),doc=createOperatorReportPdf(report);return new Response(new Uint8Array(doc.output("arraybuffer")),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${operatorPdfName(report.day)}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});}catch{return NextResponse.json({error:"Não foi possível gerar o PDF. Tente novamente."},{status:503});}
}
