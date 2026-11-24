import {NextResponse} from "next/server";
import {z} from "zod";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "@/modules/management/operator-report-server";
import {reportConfig,saveReportConfig} from "@/modules/management/operator-report-delivery";
import {googleChatWebhook,reportChatMessages,reportPeriod} from "@/modules/management/operator-report-model";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 const member=await getMemberForModule("MANAGEMENT");
 if(!member||!["MASTER","ADMIN","MANAGER"].includes(member.role))return NextResponse.json({error:"Sem permissão para relatórios da equipe."},{status:403});
 const day=new URL(request.url).searchParams.get("day")||undefined;
 try{reportPeriod(day);}catch{return NextResponse.json({error:"Selecione uma data válida anterior a hoje."},{status:400});}
 try{
  const permissions=await getRolePermissions(member.organizationId,member.role),canConfigure=["MASTER","ADMIN"].includes(member.role)&&permissions.MANAGEMENT.canManage;
  const report=await buildOperatorDayReport(member,day);
  return NextResponse.json({report,messages:reportChatMessages(report),canConfigure,config:canConfigure?await reportConfig(member.organizationId):null},{headers:{"Cache-Control":"private, no-store"}});
 }catch{return NextResponse.json({error:"Não foi possível gerar o relatório. Tente novamente."},{status:503});}
}
const input=z.object({destinationName:z.string().trim().min(1).max(120),enabled:z.boolean(),webhook:z.string().min(1).max(2000).optional()}).strict();
export async function PUT(request:Request){
 const member=await getMemberForModule("MANAGEMENT");
 if(!member||!["MASTER","ADMIN"].includes(member.role))return NextResponse.json({error:"Somente administradores e Master podem configurar o envio."},{status:403});
 const permissions=await getRolePermissions(member.organizationId,member.role);
 if(!permissions.MANAGEMENT.canManage)return NextResponse.json({error:"Sem permissão para configurar o envio."},{status:403});
 let value:z.infer<typeof input>;
 try{value=input.parse(await request.json());if(value.webhook)googleChatWebhook(value.webhook);}catch{return NextResponse.json({error:"Revise o nome do espaço e use um webhook válido do Google Chat."},{status:400});}
 try{return NextResponse.json({config:await saveReportConfig({...value,organizationId:member.organizationId,userId:member.userId})});}
 catch{return NextResponse.json({error:"Não foi possível salvar. Confira o webhook e tente novamente."},{status:503});}
}
