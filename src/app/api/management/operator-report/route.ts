import {NextResponse} from "next/server";
import {z} from "zod";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "@/modules/management/operator-report-server";
import {reportConfig,saveReportConfig,disableReportConfig} from "@/modules/management/operator-report-delivery";
import {reportChatMessages,reportPeriod} from "@/modules/management/operator-report-model";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 const member=await getMemberForModule("MANAGEMENT");
 if(!member||!["MASTER","ADMIN","MANAGER"].includes(member.role))return NextResponse.json({error:"Sem permissão para relatórios da equipe."},{status:403});
 const params=new URL(request.url).searchParams,kind=params.get("kind")==="SERVICE"?"SERVICE":"GENERAL",day=params.get("day")||undefined;
 try{if(kind!=="SERVICE")reportPeriod(day);else if(day&&!/^\d{4}-\d{2}-\d{2}$/.test(day))throw new Error("Data inválida");}catch{return NextResponse.json({error:"Selecione uma data válida anterior a hoje."},{status:400});}
 try{
  const permissions=await getRolePermissions(member.organizationId,member.role),canConfigure=["MASTER","ADMIN"].includes(member.role)&&permissions.MANAGEMENT.canManage&&permissions.MANAGEMENT.canExport;
  const report=await buildOperatorDayReport(member,day,new Date(),kind);
  return NextResponse.json({report,messages:reportChatMessages(report),canConfigure,canDownloadPdf:permissions.MANAGEMENT.canExport,config:canConfigure?await reportConfig(member.organizationId,member.userId):null},{headers:{"Cache-Control":"private, no-store"}});
 }catch{return NextResponse.json({error:"Não foi possível gerar o relatório. Tente novamente."},{status:503});}
}
const input=z.object({spaceName:z.string().regex(/^spaces\/[A-Za-z0-9_-]{1,200}$/),enabled:z.boolean()}).strict();
export async function PUT(request:Request){
 const member=await getMemberForModule("MANAGEMENT");
 if(!member||!["MASTER","ADMIN"].includes(member.role))return NextResponse.json({error:"Somente administradores e Master podem configurar o envio."},{status:403});
 const permissions=await getRolePermissions(member.organizationId,member.role);
 if(!permissions.MANAGEMENT.canManage||!permissions.MANAGEMENT.canExport)return NextResponse.json({error:"Sem permissão para configurar o envio."},{status:403});
 let value:z.infer<typeof input>;
 try{value=input.parse(await request.json());}catch{return NextResponse.json({error:"Selecione um espaço válido do Google Chat."},{status:400});}
 try{return NextResponse.json({config:await saveReportConfig({...value,organizationId:member.organizationId,userId:member.userId})});}
 catch{return NextResponse.json({error:"Não foi possível salvar. Conecte a conta Google e confira o espaço selecionado."},{status:503});}
}
export async function DELETE(){
 const member=await getMemberForModule("MANAGEMENT");if(!member||!["MASTER","ADMIN"].includes(member.role))return NextResponse.json({error:"Sem permissão."},{status:403});
 const permissions=await getRolePermissions(member.organizationId,member.role);if(!permissions.MANAGEMENT.canManage)return NextResponse.json({error:"Sem permissão."},{status:403});
 try{return NextResponse.json({config:await disableReportConfig(member.organizationId,member.userId)});}catch{return NextResponse.json({error:"Não foi possível desativar o envio."},{status:503});}
}
