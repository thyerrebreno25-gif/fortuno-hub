import {after,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {whatsappConnection} from "@/modules/whatsapp/uazapi-server";
import {processDirectorySync,scheduleDirectorySync} from "@/modules/whatsapp/directory";
export const maxDuration=120;
export async function GET(request:Request){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView)return NextResponse.json({error:"Sem permissão."},{status:403});
 const connection=await whatsappConnection(member.organizationId);
 if(!connection?.phone || connection.status!=="CONNECTED" || connection.expiresAt && connection.expiresAt<new Date())return NextResponse.json({entries:[],total:0,contacts:0,groups:0,sync:null});
 const params=new URL(request.url).searchParams,kind=params.get("kind")||"ALL",search=(params.get("search")||"").trim().slice(0,150),page=Number(params.get("page")||1);
 if(!["ALL","CONTACT","GROUP"].includes(kind)||!Number.isSafeInteger(page)||page<1||page>100000)return NextResponse.json({error:"Filtro inválido."},{status:400});
 const scope={organizationId:member.organizationId,connectionId:connection.id,accountPhone:connection.phone,active:true};
 const where={...scope,...(kind!=="ALL"?{kind}:{}),...(search?{OR:[{displayName:{contains:search,mode:"insensitive" as const}},{externalId:{contains:search}}]}:{})};
 const [entries,total,contacts,groups,sync]=await Promise.all([
  prisma.whatsAppDirectoryEntry.findMany({where,select:{id:true,displayName:true,externalId:true,kind:true},orderBy:[{displayName:"asc"},{id:"asc"}],skip:(page-1)*100,take:100}),
  prisma.whatsAppDirectoryEntry.count({where}),prisma.whatsAppDirectoryEntry.count({where:{...scope,kind:"CONTACT"}}),prisma.whatsAppDirectoryEntry.count({where:{...scope,kind:"GROUP"}}),
  prisma.whatsAppDirectorySync.findUnique({where:{connectionId_accountPhone:{connectionId:connection.id,accountPhone:connection.phone}},select:{status:true,lastError:true,completedAt:true,phase:true}})
 ]);
 after(async()=>{await scheduleDirectorySync(connection);await processDirectorySync(connection.id);});
 return NextResponse.json({entries,total,contacts,groups,sync});
}
export async function POST(){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canEdit)return NextResponse.json({error:"Sem permissão."},{status:403});
 const connection=await whatsappConnection(member.organizationId);
 if(!connection?.phone||connection.status!=="CONNECTED"||connection.expiresAt&&connection.expiresAt<new Date())return NextResponse.json({error:"Conecte o WhatsApp para sincronizar a agenda."},{status:409});
 const job=await scheduleDirectorySync(connection,true);after(async()=>{await processDirectorySync(connection.id);});
 return NextResponse.json({accepted:true,status:job?.status},{status:202});
}
