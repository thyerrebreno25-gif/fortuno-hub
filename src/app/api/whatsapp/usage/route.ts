import {NextResponse} from "next/server";
import {getServiceCenterMember,getWhatsAppPermission} from "@/modules/atendimento/auth";
import {canViewWhatsAppManagement} from "@/modules/whatsapp/management-access";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {whatsappUsagePeriod} from "@/modules/whatsapp/usage";
import {whatsappUsage} from "@/modules/whatsapp/usage-server";
export async function GET(request:Request){
 const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
 const permission=await getWhatsAppPermission(member.organizationId,member.role);
 if(!canViewWhatsAppManagement(member.role,permission.canView))return NextResponse.json({error:"Acesso restrito à gestão."},{status:403});
 const params=new URL(request.url).searchParams;let period;
 try{period=whatsappUsagePeriod(params.get("from"),params.get("to"));}catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Período inválido."},{status:400});}
 const account=await currentWhatsAppAccount(member.organizationId);
 if(!account.recipient||!account.connection?.phone)return NextResponse.json({error:"Conecte o WhatsApp para consultar o uso da conta atual."},{status:409});
 try{return NextResponse.json({...await whatsappUsage(member.organizationId,account.recipient,account.connection.phone,period.start,period.end),from:period.from,to:period.to},{headers:{"Cache-Control":"private, no-store"}});}
 catch{return NextResponse.json({error:"Não foi possível consultar os indicadores de uso."},{status:500});}
}
