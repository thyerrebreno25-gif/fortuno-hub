import {NextResponse} from "next/server";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount,accountMessageWhere} from "@/modules/whatsapp/account-scope";
import {object} from "@/modules/whatsapp/uazapi";
import {GET as downloadAttachment} from "../route";
export const runtime="nodejs";export const maxDuration=60;
export async function POST(request:Request,context:{params:Promise<{id:string;attachmentId:string}>}){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView||member.role==="CLIENT")return NextResponse.json({error:"Sem permissão."},{status:403});
 const {id,attachmentId}=await context.params,account=await currentWhatsAppAccount(member.organizationId);
 const attachment=await prisma.serviceAttachment.findFirst({where:{id:attachmentId,message:{ticketId:id,...accountMessageWhere(account.connection),ticket:account.where}},select:{message:{select:{id:true,providerMetadata:true}}}});
 if(!attachment)return NextResponse.json({error:"Áudio não encontrado nesta conta e conversa."},{status:404});
 const message=attachment.message,meta=object(message.providerMetadata);
 if(typeof meta.audioTranscript==="string"&&meta.audioTranscript)return NextResponse.json({text:meta.audioTranscript});
 const key=process.env.OPENAI_API_KEY?.trim();if(!key)return NextResponse.json({error:"A transcrição precisa da chave e do saldo da IA configurados no Hub."},{status:503});
 const count=await prisma.serviceTicketHistory.count({where:{userId:member.userId,type:"WHATSAPP_AUDIO_TRANSCRIPTION",createdAt:{gte:new Date(Date.now()-3600000)},ticket:{organizationId:member.organizationId}}});
 if(count>=30)return NextResponse.json({error:"Limite de transcrições por hora atingido."},{status:429});
 const claim=crypto.randomUUID();
 const claimed=await prisma.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" SET "providerMetadata"=COALESCE("providerMetadata",'{}'::jsonb)||${JSON.stringify({audioTranscriptState:"RUNNING",audioTranscriptClaim:claim,audioTranscriptStarted:Date.now()})}::jsonb WHERE id=${message.id} AND COALESCE("providerMetadata"->>'audioTranscript','')='' AND (COALESCE("providerMetadata"->>'audioTranscriptState','')<>'RUNNING' OR COALESCE(("providerMetadata"->>'audioTranscriptStarted')::bigint,0)<${Date.now()-120000})`);
 if(!claimed)return NextResponse.json({error:"Este áudio já está sendo transcrito. Aguarde um instante."},{status:409});
 try{
  const file=await downloadAttachment(new Request(new URL(`?preview=1`,request.url)),context);
  if(!file.ok||!file.headers.get("content-type")?.startsWith("audio/"))throw new Error("INVALID_AUDIO");
  const audio=await file.blob();if(audio.size>25000000)throw new Error("AUDIO_TOO_LARGE");
  await prisma.serviceTicketHistory.create({data:{ticketId:id,userId:member.userId,type:"WHATSAPP_AUDIO_TRANSCRIPTION",message:"Transcrição solicitada para áudio da conversa.",metadata:{messageId:message.id}}});
  const form=new FormData();form.append("file",audio,"audio."+({"audio/mpeg":"mp3","audio/mp4":"m4a","audio/webm":"webm","audio/wav":"wav"}[audio.type]||"ogg"));form.append("model",process.env.OPENAI_WHATSAPP_TRANSCRIPTION_MODEL||process.env.OPENAI_MEETING_TRANSCRIPTION_MODEL||"gpt-transcribe");form.append("language","pt");
  const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw new Error(response.status===429?"AI_LIMIT":"AI_FAILED");
  const result=await response.json();if(typeof result.text!=="string"||!result.text.trim())throw new Error("NO_SPEECH");
  const text=result.text.trim().slice(0,50000);
  await prisma.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" SET "providerMetadata"=COALESCE("providerMetadata",'{}'::jsonb)||${JSON.stringify({audioTranscript:text,audioTranscriptState:"DONE"})}::jsonb WHERE id=${message.id} AND "providerMetadata"->>'audioTranscriptClaim'=${claim}`);
  return NextResponse.json({text});
 }catch(error){
  await prisma.$executeRaw(Prisma.sql`UPDATE "ServiceMessage" SET "providerMetadata"=COALESCE("providerMetadata",'{}'::jsonb)||'{"audioTranscriptState":"FAILED"}'::jsonb WHERE id=${message.id} AND "providerMetadata"->>'audioTranscriptClaim'=${claim}`);
  return NextResponse.json({error:error instanceof Error&&error.message==="AI_LIMIT"?"A IA está sem saldo ou no limite de uso. Confira a configuração.":"Não foi possível transcrever este áudio. Confira o arquivo e a configuração da IA."},{status:502});
 }
}
