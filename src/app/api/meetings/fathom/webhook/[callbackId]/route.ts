import {NextResponse,after} from "next/server";
import {prisma} from "@/lib/prisma";
import {decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {verifyFathomWebhook,fathomMeetingSchema} from "@/modules/meetings/fathom-model";
import {importFathomMeeting} from "@/modules/meetings/fathom";
import {processMeetingReport} from "@/modules/meetings/reports";
export const maxDuration=300;
export async function POST(request:Request,{params}:{params:Promise<{callbackId:string}>}){
 const {callbackId}=await params;
 const connection=await prisma.fathomConnection.findUnique({where:{callbackId}});
 if(!connection?.enabled)return NextResponse.json({error:"Não autorizado."},{status:401});
 const raw=await request.text();if(Buffer.byteLength(raw)>8_000_000)return NextResponse.json({error:"Conteúdo excede o limite."},{status:413});
 if(!verifyFathomWebhook(decryptIntegrationSecret(connection.encryptedWebhookSecret),request.headers,raw))return NextResponse.json({error:"Assinatura inválida."},{status:401});
 let body:unknown;try{body=JSON.parse(raw);}catch{return NextResponse.json({error:"Conteúdo inválido."},{status:400});}
 const parsed=fathomMeetingSchema.safeParse(body);if(!parsed.success)return NextResponse.json({error:"Conteúdo inválido."},{status:400});
 // Persist before acknowledging. Unique recording IDs make retried events idempotent.
 const result=await importFathomMeeting(connection.id,parsed.data);
 if("meetingId" in result&&result.meetingId){const meetingId=result.meetingId;after(()=>processMeetingReport(meetingId));}
 return NextResponse.json({accepted:true,imported:result.imported});
}
