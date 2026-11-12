import {NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount,accountMessageWhere} from "@/modules/whatsapp/account-scope";
import {resolveWhatsappTicketId} from "@/modules/whatsapp/server";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView||member.role==="CLIENT")return NextResponse.json({error:"Sem permissão."},{status:403});
 const {id}=await context.params,params=new URL(request.url).searchParams,q=(params.get("q")||"").trim(),page=Number(params.get("page")||1);
 if(id.length>100||q.length<2||q.length>200||!Number.isSafeInteger(page)||page<1||page>1000)return NextResponse.json({error:"Digite de 2 a 200 caracteres para pesquisar."},{status:400});
 const account=await currentWhatsAppAccount(member.organizationId),canonicalId=await resolveWhatsappTicketId(id,member.organizationId);
 const ticket=await prisma.serviceTicket.findFirst({where:{id:canonicalId,...account.where,mergedIntoId:null,isSpam:false},select:{id:true,senderEmail:true}});
 if(!ticket)return NextResponse.json({error:"Conversa não encontrada."},{status:404});
 const rows=await prisma.serviceMessage.findMany({where:{AND:[accountMessageWhere(account.connection),{OR:[{textBody:{contains:q,mode:"insensitive"}},{attachments:{some:{name:{contains:q,mode:"insensitive"}}}}]}],ticket:{...account.where,senderEmail:ticket.senderEmail,mergedIntoId:null,isSpam:false,OR:[{id:ticket.id},{status:"RESOLVED"}]}},orderBy:[{receivedAt:"desc"},{id:"desc"}],skip:(page-1)*30,take:31,select:{id:true,ticketId:true,fromName:true,textBody:true,receivedAt:true,direction:true,attachments:{select:{id:true,name:true,mimeType:true},orderBy:{createdAt:"asc"},take:10}}});
 return NextResponse.json({items:rows.slice(0,30).map(row=>({...row,sourceTicketId:row.ticketId,ticketId:undefined})),hasMore:rows.length>30,page},{headers:{"Cache-Control":"private, no-store"}});
}
