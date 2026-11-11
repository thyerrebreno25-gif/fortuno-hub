"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Group, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import type { ExecutiveData } from "@/modules/executive/types";
export function ManagementOverview() {
  const [data,setData] = useState<ExecutiveData | null>(null), [error,setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let running = false;
    async function load() {
      if(running || document.visibilityState === "hidden") return; running = true;
      try { const r = await fetch("/api/executive?period=month", {cache:"no-store",signal:controller.signal}); const body = await r.json(); if(!r.ok) throw new Error(body.error || "Falha ao consultar resumos."); if(!controller.signal.aborted) {setData(body);setError("");} }
      catch(e) {if(!controller.signal.aborted) setError(e instanceof Error ? e.message : "Resumos indisponíveis.");} finally {running = false;}
    }
    void load(); const timer = window.setInterval(()=>void load(),300000); return ()=>{controller.abort();window.clearInterval(timer);};
  },[]);
  if(error) return <Alert color="orange">{error}</Alert>;
  if(!data) return <Text c="dimmed" size="sm">Consultando atendimentos, reuniões e operação…</Text>;
  const cards = [
    ...(data.available.whatsapp ? [{title:"WhatsApp",value:`${data.whatsapp.open} em aberto`,detail:`${data.whatsapp.resolvedPeriod} finalizados no mês · ${data.whatsapp.health.critical} com espera crítica`,href:"/whatsapp"}] : []),
    ...(data.available.email ? [{title:"E-mails",value:`${data.email.open} em aberto`,detail:`${data.email.resolvedPeriod} resolvidos no mês · ${data.email.unassigned} sem responsável`,href:"/atendimento"}] : []),
    ...(data.available.operations ? [{title:"Atividades",value:`${data.operations.completedPeriod} concluídas`,detail:`${data.operations.open} abertas · ${data.operations.overdue} atrasadas`,href:"/operacoes"}] : []),
    ...(data.available.meetings ? [{title:"Reuniões e agenda",value:`${data.meetings.today} hoje`,detail:`${data.meetings.upcoming} nos próximos 7 dias · ${data.meetings.completedPeriod} reuniões concluídas no mês`,href:"/reunioes"}] : []),
    ...(data.available.onboarding ? [{title:"Onboarding",value:`${data.onboarding.active} implantações abertas`,detail:`${data.onboarding.overdue} atrasadas · ${data.onboarding.atRisk} em atenção · ${data.onboarding.completedPeriod} concluídas no mês`,href:"/onboarding"}] : []),
    ...(data.available.support ? [{title:"Suporte",value:`${data.support.open} chamados abertos`,detail:`${data.support.resolvedPeriod} resolvidos no mês`,href:"/suporte"}] : []),
    ...(data.available.ca ? [{title:"Integrações Conta Azul",value:`${data.ca.confirmedLines} lançamentos`,detail:`Confirmados no mês · ${data.ca.failedLines} com falha registrada`,href:"/painel-gerencial"}] : []),
  ];
  return <Paper withBorder p="lg" radius="lg"><Stack><Group justify="space-between"><Title order={4}>Atendimento, agenda e operação</Title><Badge variant="light">Este mês · atualização a cada 5 min</Badge></Group><SimpleGrid cols={{base:1,sm:2,lg:3}}>{cards.map(c=><Paper withBorder p="md" radius="md" key={c.title}><Text size="sm" c="dimmed">{c.title}</Text><Text fw={800} size="xl">{c.value}</Text><Text size="xs" c="dimmed">{c.detail}</Text><Button component="a" href={c.href} variant="subtle" size="xs" px={0} mt="sm">Abrir módulo</Button></Paper>)}</SimpleGrid></Stack></Paper>;
}
