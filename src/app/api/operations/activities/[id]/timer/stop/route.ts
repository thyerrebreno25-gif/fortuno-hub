import {NextResponse} from "next/server";
import {getOperationMember} from "@/modules/operations/auth";
import {changeOperationTimer,OperationTimerError} from "@/modules/operations/timer-server";
export async function POST(_:Request,{params}:{params:Promise<{id:string}>}){
 const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 try{return NextResponse.json(await changeOperationTimer(member,(await params).id,"stop"));}catch(error){return NextResponse.json({error:error instanceof OperationTimerError?error.message:"Não foi possível atualizar o cronômetro."},{status:error instanceof OperationTimerError?error.status:500});}
}
