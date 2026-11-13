import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {canManageOperations,getOperationMember} from "@/modules/operations/auth";
export async function GET(){
 const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const now=new Date(),day=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 const activity={organizationId:member.organizationId,deletedAt:null,status:{notIn:["COMPLETED","DISREGARDED"] as ("COMPLETED"|"DISREGARDED")[]}};
 const select={activity:{select:{id:true,title:true,status:true,responsibleId:true,deletedAt:true,client:{select:{name:true}}}}};
 const entry=await prisma.operationTimeEntry.findFirst({where:{userId:member.userId,endedAt:null,activity},include:select,orderBy:{startedAt:"desc"}})||await prisma.operationTimeEntry.findFirst({where:{userId:member.userId,endedAt:{gte:new Date(day+"T00:00:00-03:00")},activity:{organizationId:member.organizationId}},include:select,orderBy:[{endedAt:"desc"},{startedAt:"desc"}]});
 let timer=null;
 if(entry&&!entry.activity.deletedAt&&!["COMPLETED","DISREGARDED"].includes(entry.activity.status)){const sum=await prisma.operationTimeEntry.aggregate({where:{activityId:entry.activityId,userId:member.userId,endedAt:{not:null}},_sum:{seconds:true}});const canControl=member.canEdit!==false&&(canManageOperations(member.role)||entry.activity.responsibleId===member.userId);timer={activityId:entry.activityId,title:entry.activity.title,clientName:entry.activity.client.name,status:entry.activity.status,running:!entry.endedAt,startedAt:entry.endedAt?null:entry.startedAt.toISOString(),seconds:sum._sum.seconds||0,canPause:member.canEdit!==false,canResume:canControl&&entry.activity.status!=="BLOCKED",canComplete:canControl};}
 return NextResponse.json({timer,serverNow:now.toISOString(),viewerKey:`${member.organizationId}:${member.userId}`},{headers:{"Cache-Control":"private, no-store"}});
}
