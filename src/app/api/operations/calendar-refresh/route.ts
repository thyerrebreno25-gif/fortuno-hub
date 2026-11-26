import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getOperationMember,canManageOperations} from "@/modules/operations/auth";
import {nextBusinessRoutine} from "@/modules/operations/routine-calendar";
import {operationToday} from "@/modules/operations/activity-deadline";
import {shiftDay} from "@/modules/operations/analytics";
import {generateActivitiesForConfigurationRange} from "@/modules/operations/recurrence";
export const maxDuration=60;

/** Bounded, resumable refresh of schedules saved under the former off-day rule. */
export async function POST(request:Request){
 try{
  const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  if(!canManageOperations(member.role)||member.canEdit===false)return NextResponse.json({error:"Sem permissão para atualizar a agenda."},{status:403});
  const body=await request.json().catch(()=>({})) as {after?:unknown};
  if(body.after!==undefined&&(typeof body.after!=="string"||body.after.length>100))return NextResponse.json({error:"Cursor inválido."},{status:400});
  const rows=await prisma.operationClientProcess.findMany({where:{active:true,client:{organizationId:member.organizationId},...(body.after?{id:{gt:body.after as string}}:{})},select:{id:true,updatedAt:true,recurrenceType:true,recurrenceData:true},orderBy:{id:"asc"}});
  const pending=rows.filter(row=>{const data=(row.recurrenceData||{}) as {interval?:number;holidayBehavior?:string};return nextBusinessRoutine(row.recurrenceType,data)&&data.holidayBehavior!=="NEXT_BUSINESS_DAY";});
  const batch=pending.slice(0,3);let changed=0;
  const today=operationToday();
  for(const row of batch){
   await generateActivitiesForConfigurationRange(row.id,new Date(today+"T12:00Z"),new Date(shiftDay(today,89)+"T12:00Z"),member.userId);
   const result=await prisma.operationClientProcess.updateMany({where:{id:row.id,active:true,updatedAt:row.updatedAt,client:{organizationId:member.organizationId}},data:{recurrenceData:{...(row.recurrenceData as Record<string,unknown>||{}),holidayBehavior:"NEXT_BUSINESS_DAY"} as never}});
   changed+=result.count;
  }
  return NextResponse.json({changed,next:pending.length>batch.length?batch.at(-1)!.id:null});
 }catch{return NextResponse.json({error:"A atualização do calendário ficou pendente. Reabra Rotinas configuradas para retomar com segurança."},{status:503});}
}
