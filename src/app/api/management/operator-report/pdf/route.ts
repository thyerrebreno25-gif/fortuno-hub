import {NextResponse} from "next/server";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "@/modules/management/operator-report-server";
import {reportPeriod} from "@/modules/management/operator-report-model";
import {createOperatorReportPdf,operatorPdfName} from "@/modules/management/operator-report-pdf";
import {filterOperatorReport} from "@/modules/management/operator-report-visual-model";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 const member=await getMemberForModule("MANAGEMENT");if(!member||!["MASTER","ADMIN","MANAGER"].includes(member.role))return NextResponse.json({error:"Sem acesso ao relatório."},{status:403});
 const permissions=await getRolePermissions(member.organizationId,member.role);if(!permissions.MANAGEMENT.canExport)return NextResponse.json({error:"Sem permissão para exportar o relatório."},{status:403});
 const params=new URL(request.url).searchParams,kind=params.get("kind")==="SERVICE"?"SERVICE":"GENERAL",day=params.get("day")||undefined;try{if(kind!=="SERVICE")reportPeriod(day);else if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error("Data inválida");}catch{return NextResponse.json({error:"Selecione um dia anterior a hoje."},{status:400});}
 try{const report=await buildOperatorDayReport(member,day,new Date(),kind),operator=params.get("operator");if(operator&&!report.rows.some(row=>row.userId===operator))return NextResponse.json({error:"Colaborador fora do escopo deste relatório."},{status:400});const doc=createOperatorReportPdf(filterOperatorReport(report,operator));return new Response(new Uint8Array(doc.output("arraybuffer")),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${operatorPdfName(report.day,kind)}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox"}});}catch{return NextResponse.json({error:"Não foi possível gerar o PDF. Tente novamente."},{status:503});}
}
