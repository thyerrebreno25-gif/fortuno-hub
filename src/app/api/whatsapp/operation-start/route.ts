import {NextResponse} from "next/server";
import {z} from "zod";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {canViewWhatsAppManagement} from "@/modules/whatsapp/management-access";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
export const maxDuration=60;
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("preview")}),z.object({action:z.literal("confirm"),asOf:z.string().datetime(),accountRecipient:z.string().min(1).max(200)})]);
export async function POST(request:Request){
  const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  const permission=await getWhatsAppPermission(member.organizationId,member.role);
  if(!permission.canEdit||!canViewWhatsAppManagement(member.role,permission.canView))return NextResponse.json({error:"Ação restrita à gestão."},{status:403});
  const input=schema.safeParse(await request.json().catch(()=>null));if(!input.success)return NextResponse.json({error:"Revise a confirmação."},{status:400});
  const account=await currentWhatsAppAccount(member.organizationId);if(!account.recipient)return NextResponse.json({error:"Conecte o WhatsApp antes de iniciar a operação."},{status:409});
  const now=new Date(),asOf=input.data.action==="preview"?now:new Date(input.data.asOf);
  if(asOf>now||now.getTime()-asOf.getTime()>15*60000||input.data.action==="confirm"&&input.data.accountRecipient!==account.recipient)return NextResponse.json({error:"A revisão expirou ou o número conectado mudou. Reabra a preparação."},{status:409});
  const where={...account.where,mergedIntoId:null,isSpam:false,status:{notIn:["RESOLVED","SPAM"] as ("RESOLVED"|"SPAM")[]},updatedAt:{lte:asOf},lastMessageAt:{lte:asOf}};
  if(input.data.action==="preview")return NextResponse.json({asOf:asOf.toISOString(),accountRecipient:account.recipient,phone:account.connection?.phone,count:await prisma.serviceTicket.count({where})},{headers:{"Cache-Control":"private, no-store"}});
  const result=await prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"whatsapp-start:"+member.organizationId}))`;
    const key={organizationId:member.organizationId,accountRecipient:account.recipient!};
    const prior=await tx.whatsAppOperationStart.findUnique({where:{organizationId_accountRecipient:key}});
    if(prior&&prior.startedAt>=asOf)return {closed:0,startedAt:prior.startedAt,repeated:true};
    const closed=await tx.serviceTicket.updateManyAndReturn({where,data:{status:"RESOLVED",resolvedAt:asOf},select:{id:true}});
    if(closed.length)await tx.serviceTicketHistory.createMany({data:closed.map(t=>({ticketId:t.id,userId:member.userId,type:"WHATSAPP_OPERATION_STARTED",message:"Chamado finalizado na preparação do início da operação."}))});
    await tx.whatsAppSurvey.updateMany({where:{organizationId:member.organizationId,status:"PENDING",createdAt:{lte:asOf}},data:{status:"CANCELLED",error:"Convite anterior ao início da operação."}});
    await tx.whatsAppOperationStart.upsert({where:{organizationId_accountRecipient:key},create:{...key,startedAt:asOf,startedById:member.userId,closedCount:closed.length},update:{startedAt:asOf,startedById:member.userId,closedCount:closed.length}});
    return {closed:closed.length,startedAt:asOf,repeated:false};
  });
  return NextResponse.json({...result,ok:true});
}
