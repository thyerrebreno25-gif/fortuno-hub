import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getAuditMember,canSuperviseAudit,isAuditAdministrator} from "@/modules/audit/auth";
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
 const member=await getAuditMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 if(!canSuperviseAudit(member.role,member.isTeamLeader))return NextResponse.json({error:"Sem permissão."},{status:403});
 const {id}=await context.params;const audit=await prisma.audit.findFirst({where:{id,organizationId:member.organizationId,...(!isAuditAdministrator(member.role)?{supervisorId:member.userId}:{})},select:{status:true,summary:true}});
 if(!audit)return NextResponse.json({error:"Auditoria não encontrada."},{status:404});
 const summary=audit.summary&&typeof audit.summary==="object"&&!Array.isArray(audit.summary)?audit.summary:{};
 if(audit.status!=="COMPLETED"||!summary.completionReport)return NextResponse.json({error:"Esta auditoria ainda não possui relatório de finalização. Relatórios são gerados nas novas finalizações."},{status:409});
 return NextResponse.json({report:summary.completionReport},{headers:{"Cache-Control":"no-store"}});
}
