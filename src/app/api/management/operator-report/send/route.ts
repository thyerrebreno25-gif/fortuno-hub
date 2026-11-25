import {NextResponse} from "next/server";
import {z} from "zod";
import {getMemberForModule} from "@/modules/assistant/auth";
import {sendManualOperatorReport} from "@/modules/management/operator-report-manual";
import {OperatorChatError,operatorChatErrorBody} from "@/modules/management/operator-chat-error";
import {reportPeriod} from "@/modules/management/operator-report-model";
export const runtime="nodejs";
export const maxDuration=120;
const input=z.object({day:z.string(),requestId:z.uuidv4(),revision:z.string().min(1).max(100)}).strict();
export async function POST(request:Request){
 const member=await getMemberForModule("MANAGEMENT");
 const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
 if(!member||!["MASTER","ADMIN"].includes(member.role))return json({error:"Somente Master e administradores podem enviar relatórios ao espaço de gestores."},403);
 if(!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")||(request.headers.get("Origin")&&request.headers.get("Origin")!==new URL(request.url).origin))return json({error:"Origem do envio inválida."},403);
 let value:z.infer<typeof input>;
 try{value=input.parse(await request.json());reportPeriod(value.day);}catch{return json({error:"Selecione um dia anterior a hoje e atualize o relatório antes de enviar."},400);}
 try{return json(await sendManualOperatorReport(member,value));}
 catch(error){return json(error instanceof OperatorChatError?operatorChatErrorBody(error):{error:"Não foi possível confirmar o envio do PDF. Tente novamente para retomar a mesma tentativa."},error instanceof OperatorChatError?error.status:503);}
}
