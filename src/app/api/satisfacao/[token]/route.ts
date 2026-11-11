import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {surveyTokenHash} from "@/modules/whatsapp/surveys";
import {surveyAnswerSchema} from "@/modules/whatsapp/survey-core";
type Context={params:Promise<{token:string}>};
const headers={"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Robots-Tag":"noindex, nofollow"};
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers});
const valid=(token:string)=>/^[A-Za-z0-9_-]{43}$/.test(token);
export async function GET(_request:Request,context:Context){
  const {token}=await context.params;if(token==="preview")return json({state:"OPEN",preview:true});
  if(!valid(token))return json({state:"UNAVAILABLE"},404);
  const survey=await prisma.whatsAppSurvey.findUnique({where:{tokenHash:surveyTokenHash(token)},select:{status:true,expiresAt:true}});
  if(!survey)return json({state:"UNAVAILABLE"},404);
  if(["ANSWERED","DECLINED"].includes(survey.status))return json({state:"DONE"});
  if(!survey.expiresAt||survey.expiresAt<=new Date()||!["SENT","UNKNOWN","SENDING"].includes(survey.status))return json({state:"EXPIRED"});
  return json({state:"OPEN",preview:false});
}
export async function POST(request:Request,context:Context){
  const {token}=await context.params;if(token!=="preview"&&!valid(token))return json({error:"Link inválido."},404);
  if(Number(request.headers.get('content-length')||0)>8000)return json({error:"Resposta muito longa."},413);
  const parsed=surveyAnswerSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return json({error:"Informe seu nome, escolha uma nota de 1 a 5 e limite o comentário a 1.000 caracteres."},400);
  if(token==="preview")return json({ok:true,preview:true});
  const hash=surveyTokenHash(token),now=new Date(),input=parsed.data;
  const result=await prisma.$transaction(async tx=>{
    const locked=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "WhatsAppSurvey" WHERE "tokenHash"=${hash} FOR UPDATE`;
    if(!locked.length)return "UNAVAILABLE";
    const survey=await tx.whatsAppSurvey.findUnique({where:{tokenHash:hash}});
    if(!survey)return "UNAVAILABLE";
    if(["ANSWERED","DECLINED"].includes(survey.status))return "DONE";
    if(!survey.expiresAt||survey.expiresAt<=now||!["SENT","UNKNOWN","SENDING"].includes(survey.status))return "EXPIRED";
    await tx.whatsAppSurvey.update({where:{id:survey.id},data:{status:input.decline?"DECLINED":"ANSWERED",answeredAt:now,score:input.decline?null:input.score!,comment:input.decline?null:input.comment||null}});
    if(input.optOut){
      const key={organizationId:survey.organizationId,clientId:survey.clientId};
      await tx.whatsAppSurveyClientState.upsert({where:{organizationId_clientId:key},create:{...key,optedOutAt:now},update:{optedOutAt:now}});
      await tx.whatsAppSurvey.updateMany({where:{...key,status:"PENDING"},data:{status:"CANCELLED",error:"Cliente recusou novas pesquisas."}});
    }
    if(!input.decline){
      const ticket=await tx.serviceTicket.findFirst({where:{id:survey.ticketId,organizationId:survey.organizationId},select:{id:true}});
      if(ticket)await tx.serviceTicketHistory.create({data:{ticketId:ticket.id,type:"WHATSAPP_SATISFACTION",message:"Avaliação recebida do cliente pela pesquisa periódica.",metadata:{respondentName:input.respondentName,score:input.score!,comment:input.comment||null,origin:"CUSTOMER_SURVEY",surveyId:survey.id,clientId:survey.clientId,operatorId:survey.operatorId}}});
    }
    return "OK";
  });
  return result==="OK"?json({ok:true}):json({error:result==="DONE"?"Esta pesquisa já foi respondida.":"Esta pesquisa está indisponível ou expirou.",state:result},result==="DONE"?409:410);
}
