import {NextResponse} from "next/server";
import {z} from "zod";
import {getMemberForModule} from "@/modules/assistant/auth";
import {getRolePermissions} from "@/modules/permissions/permissions";
import {buildOperatorDayReport} from "@/modules/management/operator-report-server";
import {publishExecutiveReport,revokeExecutiveReport} from "@/modules/management/executive-report-share";
const input=z.object({day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),kind:z.enum(["GENERAL","SERVICE"]),requestId:z.uuid()}).strict();
export const maxDuration=60;
async function access(){const member=await getMemberForModule("MANAGEMENT");if(!member||!["MASTER","ADMIN"].includes(member.role))return null;const permission=await getRolePermissions(member.organizationId,member.role);return permission.MANAGEMENT.canView&&permission.MANAGEMENT.canManage&&permission.MANAGEMENT.canExport?member:null;}
export async function POST(request:Request){
 const member=await access();if(!member)return NextResponse.json({error:"Sem permissão para publicar relatórios executivos."},{status:403});
 const parsed=input.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Confira a data e o tipo do relatório."},{status:400});
 try{const {day,kind,requestId}=parsed.data,report=await buildOperatorDayReport(member,day,new Date(),kind);return NextResponse.json(await publishExecutiveReport(member.organizationId,member.userId,`preview:${member.userId}:${kind}:${day}:${requestId}`,report),{headers:{"Cache-Control":"private, no-store"}});}catch{return NextResponse.json({error:"Não foi possível preparar o dashboard executivo. Tente novamente."},{status:503});}
}
export async function DELETE(request:Request){const member=await access();if(!member)return NextResponse.json({error:"Sem permissão."},{status:403});const parsed=z.object({id:z.uuid()}).strict().safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Link inválido."},{status:400});await revokeExecutiveReport(member.organizationId,parsed.data.id);return NextResponse.json({revoked:true});}
