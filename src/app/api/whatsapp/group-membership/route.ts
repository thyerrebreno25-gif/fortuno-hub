import {NextResponse} from "next/server";
import {z} from "zod";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {groupTarget} from "@/modules/whatsapp/group-target";
import {whatsappConnection} from "@/modules/whatsapp/uazapi-server";
import {uazapiRequest} from "@/modules/whatsapp/uazapi";
import {decryptIntegrationSecret} from "@/modules/purchase-invoices/server/crypto";
import {chatProfile} from "@/modules/whatsapp/chat-info";
import {groupAccountIsAdmin,groupParticipantInput} from "@/modules/whatsapp/group-management-policy";
export const maxDuration=120;
const input=z.object({participant:z.string().max(40),groups:z.array(z.string().min(1).max(150)).min(1).max(25)});
export async function POST(request:Request){
 if(request.headers.get("origin")!==new URL(request.url).origin)return NextResponse.json({error:"Origem inválida."},{status:403});
 const actor=await getServiceCenterMember();if(!actor)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(actor.organizationId,actor.role);
 if(actor.role==="CLIENT"||!permission.canView||!permission.canEdit)return NextResponse.json({error:"Sem permissão."},{status:403});
 const parsed=input.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Selecione até 25 grupos e informe um telefone válido."},{status:400});
 const number=groupParticipantInput.safeParse({action:"add",participant:parsed.data.participant,requestId:"00000000-0000-4000-8000-000000000000"});
 if(!number.success)return NextResponse.json({error:"Informe o telefone com DDI e DDD."},{status:400});
 const account=await currentWhatsAppAccount(actor.organizationId),connection=await whatsappConnection(actor.organizationId);
 if(!account.recipient||!connection?.phone||connection.status!=="CONNECTED"||connection.id!==account.connection?.id||connection.instanceId!==account.connection?.instanceId||account.recipient!==`wa-account:${connection.id}:${connection.phone}`)return NextResponse.json({error:"Conecte o WhatsApp e atualize a tela."},{status:409});
 const token=decryptIntegrationSecret(connection.tokenEncrypted),ids=[...new Set(parsed.data.groups)];
 const results:Array<{id:string;state:"PRESENT"|"ABSENT"|"UNKNOWN";canAdd:boolean;message:string}>=[];
 for(let index=0;index<ids.length;index+=2){
  results.push(...await Promise.all(ids.slice(index,index+2).map(async id=>{
   try{const groupjid=await groupTarget(id,account,actor,permission);
    const profile=chatProfile(await uazapiRequest(connection.serverUrl,token,"/group/info",{groupjid,force:true},{timeoutMs:5000}),true);
    if(profile.participants.some(person=>person.phone===number.data.participant))return {id,state:"PRESENT" as const,canAdd:false,message:"Este número já está no grupo."};
    if(!profile.participantsAvailable)return {id,state:"UNKNOWN" as const,canAdd:false,message:"O WhatsApp não retornou a lista de membros. Tente conferir novamente."};
    const canAdd=groupAccountIsAdmin(profile,connection.phone!);
    return {id,state:"ABSENT" as const,canAdd,message:canAdd?"Número ainda não participa do grupo.":"O WhatsApp conectado precisa ser administrador deste grupo."};
   }catch(error){return {id,state:"UNKNOWN" as const,canAdd:false,message:error instanceof Error&&/^(Grupo|Conversa|Assuma|Este registro)/.test(error.message)?error.message:"Não foi possível conferir os membros deste grupo."};}
  })));
 }
 const latest=await currentWhatsAppAccount(actor.organizationId);
 if(latest.recipient!==account.recipient||latest.connection?.instanceId!==connection.instanceId)return NextResponse.json({error:"A conta conectada mudou. Confira novamente."},{status:409});
 return NextResponse.json({results},{headers:{"Cache-Control":"private, no-store"}});
}
