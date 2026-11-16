import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import type {Prisma} from "@/generated/prisma/client";
import {getAuditMember,canSuperviseAudit,isAuditAdministrator} from "@/modules/audit/auth";
import {AuditConflict,lockAudit} from "@/modules/audit/server/workflow";
import {completionBlocker,type AuditCompletionReport} from "@/modules/audit/completion";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const member=await getAuditMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 if(!canSuperviseAudit(member.role,member.isTeamLeader))return NextResponse.json({error:"Apenas gestores podem finalizar auditorias."},{status:403});
 const {id}=await context.params;const body=await request.json().catch(()=>({}));const note=typeof body.note==="string"?body.note.trim():"";
 if(note.length>10000)return NextResponse.json({error:"Limite de 10.000 caracteres para a observação final."},{status:400});
 try{
 const report=await prisma.$transaction(async tx=>{
  await lockAudit(tx,id,member.organizationId);
  const audit=await tx.audit.findFirst({where:{id,organizationId:member.organizationId},include:{client:{select:{name:true}},findings:{orderBy:{createdAt:"asc"},include:{operator:{select:{name:true,email:true}},interactions:{orderBy:{createdAt:"asc"},include:{user:{select:{name:true,email:true}}}}}},checklist:{orderBy:{position:"asc"},include:{reviewedBy:{select:{name:true,email:true}}}}}});
  if(!audit)throw new AuditConflict("Auditoria não encontrada.");
  if(!isAuditAdministrator(member.role)&&audit.supervisorId!==member.userId)throw new AuditConflict("Somente o gestor responsável pode finalizar esta auditoria.");
  const blocker=completionBlocker(audit.findings,audit.checklist);if(blocker)throw new AuditConflict(blocker);
  const summary=audit.summary&&typeof audit.summary==="object"&&!Array.isArray(audit.summary)?audit.summary:{};
  const history=summary.history&&typeof summary.history==="object"&&!Array.isArray(summary.history)?summary.history:null;
  const rules=summary.rules&&typeof summary.rules==="object"&&!Array.isArray(summary.rules)?summary.rules:null;
  const completedAt=new Date();
  const snapshot:AuditCompletionReport={version:1,auditId:id,client:audit.client.name,periodStart:audit.periodStart?.toISOString().slice(0,10)||null,periodEnd:audit.periodEnd?.toISOString().slice(0,10)||null,completedAt:completedAt.toISOString(),completedBy:member.user.name||member.user.email,note,source:summary.source==="CONTA_AZUL_API"?"Conta Azul (API)":"Relatórios PDF",history:history?`${history.start} a ${history.end}`:"Conforme relatórios importados",criteria:rules?`Serviços mensais: mês anterior; avulsos: dia do pagamento; variação: ${rules.variationPercent}% e R$ 100; saldo zero: somente contas transitórias.`:"Critérios registrados na análise original e revisão do gestor.",limitations:Array.isArray(summary.limitations)?summary.limitations.filter((value):value is string=>typeof value==="string"):[],findings:audit.findings.map(finding=>({title:finding.title,description:finding.description,status:finding.status,subject:finding.subject,category:finding.category,amount:finding.amount?.toString()||null,operator:finding.operator?.name||finding.operator?.email||"Sem operador",supervisorNote:finding.supervisorNote,evidence:Array.isArray(finding.evidence)?finding.evidence.filter((value):value is {label:string;value:string}=>!!value&&typeof value==="object"&&!Array.isArray(value)&&typeof value.label==="string"&&typeof value.value==="string"):[],history:finding.interactions.map(item=>({action:item.action,actor:item.user.name||item.user.email,date:item.createdAt.toISOString(),note:item.note}))})),checklist:audit.checklist.map(item=>({title:item.title,category:item.category,status:item.status,note:item.note,reviewedBy:item.reviewedBy?.name||item.reviewedBy?.email||"Não revisado",reviewedAt:item.reviewedAt?.toISOString()||null}))};
  await tx.audit.update({where:{id},data:{status:"COMPLETED",completedAt,summary:{...summary,completionReport:snapshot} as unknown as Prisma.InputJsonValue}});
  return snapshot;
 },{timeout:20000});return NextResponse.json({report});
 }catch(error){if(error instanceof AuditConflict)return NextResponse.json({error:error.message},{status:409});throw error;}
}
