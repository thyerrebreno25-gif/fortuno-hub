/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

function startDate(period: string) {
  const now = new Date();
  const d = new Date(now);
  if (period === "7d") d.setDate(d.getDate() - 6);
  else if (period === "90d") d.setDate(d.getDate() - 89);
  else if (period === "year") d.setMonth(0, 1);
  else d.setDate(d.getDate() - 29);
  d.setHours(0, 0, 0, 0); return d;
}
export async function GET(request: Request) {
  try {
    const supabase = await createSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const member = await prisma.organizationMember.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { organizationId: true, role: true } });
    if (!member) return NextResponse.json({ error: "Organização não encontrada." }, { status: 403 });
    const url = new URL(request.url); const period = url.searchParams.get("period") || "30d"; const from = startDate(period);
    const where = { organizationId: member.organizationId, createdAt: { gte: from }, ...(member.role === "OPERATOR" ? { userId: user.id } : {}) } as const;
    const [imports, clients, onboardings] = await Promise.all([
      prisma.importJob.findMany({ where, include: { client: { select: { name: true } }, user: { select: { name: true, email: true } }, transactions: { select: { amount: true, type: true } } }, orderBy: { createdAt: "desc" } }),
      prisma.client.count({ where: { organizationId: member.organizationId, active: true } }),
      prisma.onboarding.findMany({ where: { organizationId: member.organizationId }, include: { tasks: { select: { status: true, timeEntries: { select: { seconds: true, startedAt: true, endedAt: true } } } } } }),
    ]);
    const byModule: Record<string, number> = {}; const byStatus: Record<string, number> = {}; const byUser: Record<string, number> = {}; const daily: Record<string, { total:number; success:number; failed:number }> = {};
    let credits=0, debits=0;
    for (const item of imports) {
      byModule[item.module]=(byModule[item.module]||0)+1; byStatus[item.status]=(byStatus[item.status]||0)+1; const name=item.user.name||item.user.email; byUser[name]=(byUser[name]||0)+1;
      const key=item.createdAt.toISOString().slice(0,10); daily[key]??={total:0,success:0,failed:0}; daily[key].total++; if(item.status==="FAILED")daily[key].failed++; if(item.status==="EXPORTED"||item.status==="VALIDATED")daily[key].success++;
      for(const tx of item.transactions){ if(tx.type==="CREDIT") credits+=Number(tx.amount); else debits+=Number(tx.amount); }
    }
    const activeOnboardings=onboardings.filter(o=>o.status!=="COMPLETED"&&o.status!=="CANCELLED").length;
    const overdueOnboardings=onboardings.filter(o=>o.status!=="COMPLETED"&&o.expectedEndDate<new Date()).length;
    const onboardingSeconds=onboardings.flatMap(o=>o.tasks).flatMap(t=>t.timeEntries).reduce((s,e)=>s+e.seconds,0);
    return NextResponse.json({ generatedAt:new Date().toISOString(), period, summary:{ totalImports:imports.length, successful:(byStatus.EXPORTED||0)+(byStatus.VALIDATED||0), failed:byStatus.FAILED||0, pending:(byStatus.UPLOADED||0)+(byStatus.PROCESSING||0)+(byStatus.REVIEW||0), activeClients:clients, activeOnboardings, overdueOnboardings, onboardingHours:Math.round(onboardingSeconds/36)/100, credits, debits }, byModule:Object.entries(byModule).map(([name,total])=>({name,total})), byStatus:Object.entries(byStatus).map(([name,total])=>({name,total})), byUser:Object.entries(byUser).map(([name,total])=>({name,total})).sort((a,b)=>b.total-a.total), daily:Object.entries(daily).sort(([a],[b])=>a.localeCompare(b)).map(([date,v])=>({date,...v})), recent:imports.slice(0,30).map(i=>({id:i.id,name:i.originalName,module:i.module,status:i.status,client:i.client?.name||null,user:i.user.name||i.user.email,createdAt:i.createdAt.toISOString(),difference:i.difference?Number(i.difference):0,metadata:i.metadata})) });
  } catch(error){ console.error("Erro nos relatórios:",error); return NextResponse.json({error:"Não foi possível carregar os relatórios."},{status:500}); }
}
