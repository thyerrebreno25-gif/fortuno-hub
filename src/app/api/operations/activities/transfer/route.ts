import {NextResponse} from "next/server";
import {getOperationMember} from "@/modules/operations/auth";
import {transferActivityInput} from "@/modules/operations/transfer-model";
import {previewActivityTransfer,requireActivityTransfer,transferActivities} from "@/modules/operations/transfer-server";
import {OperationTimerError} from "@/modules/operations/timer-server";
export const maxDuration=60;
export async function POST(request:Request){
 try{
  const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  requireActivityTransfer(member);
  const input=transferActivityInput.safeParse(await request.json().catch(()=>null));
  if(!input.success)return NextResponse.json({error:"Selecione de 1 a 1.500 atividades e um destinatário válido."},{status:400});
  const result=input.data.action==="preview"?await previewActivityTransfer(member,input.data.activityIds):await transferActivities(member,input.data);
  return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){return NextResponse.json({error:error instanceof OperationTimerError?error.message:"Não foi possível transferir as atividades. Atualize a lista e tente novamente."},{status:error instanceof OperationTimerError?error.status:500});}
}
