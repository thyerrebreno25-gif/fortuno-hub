import {NextResponse} from "next/server";
import {z} from "zod";
import {getOperationMember} from "@/modules/operations/auth";
import {uncheckRoutineCell} from "@/modules/operations/routine-uncheck-server";
import {OperationTimerError} from "@/modules/operations/timer-server";
export const maxDuration=60;
const input=z.object({clientId:z.string().min(1).max(100),columnId:z.string().min(1).max(200),routines:z.array(z.object({id:z.string().min(1).max(100),updatedAt:z.iso.datetime()})).min(1).max(100)}).strict();
export async function POST(request:Request){try{const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});const parsed=input.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Atualize a célula antes de desmarcar a rotina."},{status:400});return NextResponse.json(await uncheckRoutineCell(member,parsed.data));}catch(error){return NextResponse.json({error:error instanceof OperationTimerError?error.message:"Não foi possível desmarcar a rotina. Atualize a tabela e tente novamente."},{status:error instanceof OperationTimerError?error.status:500});}}
