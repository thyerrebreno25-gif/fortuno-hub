import {operationStartedAt} from "@/modules/whatsapp/operation-start";
import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {canViewWhatsAppManagement} from "@/modules/whatsapp/management-access";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {DEFAULT_SURVEY_MESSAGE,surveyPolicySchema,surveySummary} from "@/modules/whatsapp/survey-core";
export async function GET(request:Request) {
  const member=await getServiceCenterMember();if(!member||member.role==="CLIENT")return NextResponse.json({error:"Sem acesso."},{status:403});
  const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView)return NextResponse.json({error:"Sem acesso."},{status:403});
  const params=new URL(request.url).searchParams,from=params.get("from"),to=params.get("to"),clientId=params.get("clientId"),operatorId=params.get("assigneeId");
  const start=from&&/^\d{4}-\d{2}-\d{2}$/.test(from)?new Date(from+"T00:00:00-03:00"):new Date(Date.now()-30*86400000),end=to&&/^\d{4}-\d{2}-\d{2}$/.test(to)?new Date(to+"T23:59:59.999-03:00"):new Date();
  if(!Number.isFinite(start.getTime()+end.getTime())||start>end||end.getTime()-start.getTime()>370*86400000||(clientId?.length||0)>100||(operatorId?.length||0)>100)return NextResponse.json({error:"Filtros inválidos."},{status:400});
  const account=await currentWhatsAppAccount(member.organizationId);
  const baseline=await operationStartedAt(member.organizationId,account.recipient);
  const [policy,rows]=await Promise.all([
    prisma.whatsAppSurveyPolicy.findUnique({where:{organizationId:member.organizationId}}),
    prisma.whatsAppSurvey.findMany({where:{organizationId:member.organizationId,accountRecipient:account.recipient||"disconnected",...(baseline?{createdAt:{gte:baseline}}:{}),...(clientId?{clientId}:{}),...(operatorId?{operatorId}:{}),OR:[{sentAt:{gte:start,lte:end}},{answeredAt:{gte:start,lte:end}},{status:"PENDING",createdAt:{gte:start,lte:end}}]},orderBy:{createdAt:"desc"},take:10000,select:{id:true,clientName:true,operatorName:true,status:true,score:true,comment:true,sentAt:true,answeredAt:true,scheduledAt:true,error:true}}),
  ]);
  return NextResponse.json({policy:policy||{enabled:false,cadenceDays:15,delayMinutes:30,message:DEFAULT_SURVEY_MESSAGE},canConfigure:permission.canEdit&&canViewWhatsAppManagement(member.role,true),summary:surveySummary(rows),responses:rows.filter(r=>r.status==="ANSWERED").slice(0,100),recent:rows.slice(0,50)},{headers:{"Cache-Control":"private, no-store"}});
}
export async function PUT(request:Request) {
  const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  const permission=await getWhatsAppPermission(member.organizationId,member.role);
  if(!permission.canEdit||!canViewWhatsAppManagement(member.role,permission.canView))return NextResponse.json({error:"Configuração restrita à gestão."},{status:403});
  const parsed=surveyPolicySchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Revise a frequência, o prazo e o texto. Inclua {{link}} uma única vez."},{status:400});
  const current=await prisma.whatsAppSurveyPolicy.findUnique({where:{organizationId:member.organizationId}});
  const data={...parsed.data,...(parsed.data.enabled&&!current?.enabled?{activatedAt:new Date()}:{} )};
  await prisma.$transaction(async tx=>{await tx.whatsAppSurveyPolicy.upsert({where:{organizationId:member.organizationId},create:{organizationId:member.organizationId,...data},update:data});if(!data.enabled)await tx.whatsAppSurvey.updateMany({where:{organizationId:member.organizationId,status:"PENDING"},data:{status:"CANCELLED",error:"Envios pausados pela gestão."}});});
  return NextResponse.json({ok:true});
}
