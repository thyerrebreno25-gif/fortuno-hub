import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {Prisma} from "@/generated/prisma/client";
import {prisma} from "@/lib/prisma";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {batchAddress} from "@/modules/whatsapp/batch-recipients";
import {resolveBroadcast,type BroadcastTarget} from "@/modules/whatsapp/broadcast-model";
const schema=z.object({id:z.string().uuid().optional(),name:z.string().trim().min(2).max(100),recipients:z.array(z.object({clientId:z.string().min(1),ticketId:z.string().min(1)})).min(1).max(50)});
async function access(){const member=await getServiceCenterMember();if(!member||member.role==="CLIENT")return null;const permission=await getWhatsAppPermission(member.organizationId,member.role);if(!permission.canView||!permission.canEdit)return null;const account=await currentWhatsAppAccount(member.organizationId);return account.recipient?{member,account}:null;}
type List={id:string;name:string;recipients:BroadcastTarget[];createdById:string};
export async function GET(request:Request){
 const viewer=await access();if(!viewer)return NextResponse.json({error:"Conecte o WhatsApp e confira sua permissão."},{status:403});
 const {member,account}=viewer,lists=await prisma.$queryRaw<List[]>(Prisma.sql`SELECT id,name,recipients,"createdById" FROM "WhatsAppBroadcastList" WHERE "organizationId"=${member.organizationId} AND "accountRecipient"=${account.recipient} ORDER BY name,id`),id=new URL(request.url).searchParams.get("id");
 if(!id)return NextResponse.json({lists:lists.map(l=>({id:l.id,name:l.name,count:l.recipients.length,canEdit:l.createdById===member.userId||["MASTER","ADMIN","MANAGER"].includes(member.role)}))},{headers:{"Cache-Control":"private, no-store"}});
 const list=lists.find(l=>l.id===id);if(!list)return NextResponse.json({error:"Lista não encontrada."},{status:404});
 const clients=await prisma.client.findMany({where:{organizationId:member.organizationId,active:true,id:{in:list.recipients.map(t=>t.clientId)}},select:{id:true,name:true,serviceTickets:{where:{...account.where,mergedIntoId:null,isSpam:false,status:{not:"SPAM"}},orderBy:[{lastMessageAt:"desc"},{id:"asc"}],select:{id:true,senderName:true,subject:true,senderEmail:true,status:true,lastMessageAt:true,assignedTo:{select:{name:true,email:true}}}}}});
 return NextResponse.json(resolveBroadcast(list.recipients,clients),{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request:Request){
 const viewer=await access();if(!viewer)return NextResponse.json({error:"Sem permissão de envio."},{status:403});
 const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Informe um nome e selecione de 1 a 50 clientes."},{status:400});
 const {member,account}=viewer,input=parsed.data;
 const tickets=await prisma.serviceTicket.findMany({where:{...account.where,id:{in:input.recipients.map(t=>t.ticketId)},mergedIntoId:null,isSpam:false,status:{not:"SPAM"},client:{active:true}},select:{id:true,clientId:true,senderEmail:true}});
 const targets=input.recipients.map(t=>{const ticket=tickets.find(row=>row.id===t.ticketId&&row.clientId===t.clientId);return ticket?{clientId:t.clientId,address:batchAddress(ticket.senderEmail)}:null;});
 if(targets.some(t=>!t)||new Set(targets.map(t=>t?.clientId)).size!==targets.length||new Set(targets.map(t=>t?.address)).size!==targets.length)return NextResponse.json({error:"Revise os clientes e os vínculos dos destinos. Cada cliente e contato deve aparecer uma vez."},{status:409});
 const id=input.id||randomUUID();
 const changed=await prisma.$executeRaw(Prisma.sql`INSERT INTO "WhatsAppBroadcastList" (id,"organizationId","accountRecipient","createdById",name,recipients) VALUES (${id},${member.organizationId},${account.recipient},${member.userId},${input.name},${JSON.stringify(targets)}::jsonb)
 ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,recipients=EXCLUDED.recipients,"updatedAt"=CURRENT_TIMESTAMP WHERE "WhatsAppBroadcastList"."organizationId"=${member.organizationId} AND "WhatsAppBroadcastList"."accountRecipient"=${account.recipient} AND ("WhatsAppBroadcastList"."createdById"=${member.userId} OR ${["MASTER","ADMIN","MANAGER"].includes(member.role)})`);
 return changed?NextResponse.json({id}):NextResponse.json({error:"Sem permissão para editar esta lista."},{status:403});
}
export async function DELETE(request:Request){const viewer=await access();if(!viewer)return NextResponse.json({error:"Sem permissão."},{status:403});const {member,account}=viewer,id=new URL(request.url).searchParams.get("id")||"";
 const removed=await prisma.$executeRaw(Prisma.sql`DELETE FROM "WhatsAppBroadcastList" WHERE id=${id} AND "organizationId"=${member.organizationId} AND "accountRecipient"=${account.recipient} AND ("createdById"=${member.userId} OR ${["MASTER","ADMIN","MANAGER"].includes(member.role)})`);return removed?NextResponse.json({removed:true}):NextResponse.json({error:"Lista indisponível ou sem permissão."},{status:404});}
