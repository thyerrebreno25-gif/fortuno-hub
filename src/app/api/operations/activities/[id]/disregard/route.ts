import {NextResponse} from "next/server";
import {getOperationMember} from "@/modules/operations/auth";
import {decideDisregard} from "@/modules/operations/disregard-server";
import {OperationTimerError} from "@/modules/operations/timer-server";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});try{const body=await request.json();if(!["approve","reject"].includes(body.action)||typeof body.requestId!=="string")return NextResponse.json({error:"Decisão inválida."},{status:400});return NextResponse.json(await decideDisregard(member,(await params).id,body.requestId,body.action==="approve"));}catch(error){return NextResponse.json({error:error instanceof OperationTimerError?error.message:"Não foi possível registrar a decisão."},{status:error instanceof OperationTimerError?error.status:500});}}
