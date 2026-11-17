import { whatsappUsage } from "@/modules/whatsapp/usage-server";
import { usageSnapshot } from "@/modules/usage/server";
import { usagePeriod } from "@/modules/usage/model";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {NextResponse} from "next/server";
import {unstable_cache} from "next/cache";
import {getCurrentMember,getRolePermissions} from "@/modules/permissions/permissions";
import {managementRole,executivePeriod} from "@/modules/executive/model";
import {executiveSnapshot,type ExecutiveScope} from "@/modules/executive/server";
import {executiveLoad} from "@/modules/executive/loading";
export const maxDuration=60;
export async function GET(request:Request){
 try{
  const member=await getCurrentMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});
  const permissions=await getRolePermissions(member.organizationId,member.role);
  if(!managementRole(member.role)||!permissions.MANAGEMENT.canView)return NextResponse.json({error:"Painel restrito aos perfis de gestão."},{status:403});
  const value=new URL(request.url).searchParams.get("period")||"today";
  if(!["today","week","month"].includes(value))return NextResponse.json({error:"Período inválido."},{status:400});
  const period=executivePeriod(value);
  const scope:ExecutiveScope={onboarding:permissions.ONBOARDING.canView,clients:permissions.CLIENTS.canView,whatsapp:permissions.WHATSAPP.canView,email:permissions.SERVICE_CENTER.canView,support:permissions.SUPPORT.canView,operations:permissions.OPERATIONS.canView,meetings:permissions.MEETINGS.canView,calendar:permissions.CALENDAR.canView,finance:permissions.IMPORTS.canView,purchase:permissions.PURCHASE_INVOICES.canView,investment:permissions.INVESTMENT_INCOME.canView,contract:permissions.CONTRACT_IMPORTS.canView,ca:false};
  scope.ca=scope.finance||scope.purchase||scope.investment||scope.contract;
  // A new time bucket gives each five-minute refresh fresh data instead of
  // returning the previous snapshot while a stale cache revalidates.
  const refreshBucket=String(Math.floor(Date.now()/300000));
  const account=scope.whatsapp?await currentWhatsAppAccount(member.organizationId):null;
  const cacheKey=["executive-v8",account?.accountKey||"none",member.organizationId,period.key,period.to,refreshBucket,JSON.stringify({...scope,usageViews:Object.fromEntries(Object.entries(permissions).map(([key,value])=>[key,value.canView]))})];
  const data=await unstable_cache(()=>executiveLoad(JSON.stringify(cacheKey),async()=>{
    // The runtime pool has two connections. General usage and WhatsApp usage
    // each run their own queries, so start them after the main snapshot rather
    // than competing with all of its metrics for the same pool.
    const snapshot=await executiveSnapshot(member.organizationId,period.key,scope,account?.recipient||null);
    const usage=await usageSnapshot(member.organizationId,usagePeriod(period.from,period.to),permissions,{}).catch(()=>null);
    const whatsappEngagement=scope.whatsapp&&account?.recipient&&account.connection?.phone?await whatsappUsage(member.organizationId,account.recipient,account.connection.phone,period.start,period.end).catch(()=>null):null;
    return {...snapshot,whatsappEngagement,engagement:usage?{total:usage.total,summary:usage.summary,byUser:usage.byUser,byPage:usage.byPage}:null};
  }),cacheKey,{revalidate:300})();
  return NextResponse.json(data,{headers:{"Cache-Control":"private, no-store"}});
 }catch(error){console.error("Erro no painel gerencial:",error);return NextResponse.json({error:"Não foi possível atualizar o painel gerencial."},{status:503});}
}
