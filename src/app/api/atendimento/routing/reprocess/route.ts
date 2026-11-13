import {NextResponse} from "next/server";
import {getServiceCenterMember,getServiceCenterPermission,SERVICE_CENTER_MANAGER_ROLES} from "@/modules/atendimento/auth";
import {rerouteGmailTickets} from "@/modules/atendimento/routing/reprocess";
export const maxDuration=120;
export async function POST(){const member=await getServiceCenterMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});const p=await getServiceCenterPermission(member.organizationId,member.role);if(!p.canView||!p.canEdit||!SERVICE_CENTER_MANAGER_ROLES.has(member.role))return NextResponse.json({error:"Reclassificação restrita à gestão."},{status:403});const result=await rerouteGmailTickets(member.organizationId);return NextResponse.json(result,{headers:{"Cache-Control":"private, no-store"}});}
