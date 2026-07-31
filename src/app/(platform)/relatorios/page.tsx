/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Center, Group, Loader, Paper, Progress, ScrollArea, Select, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { IconAlertTriangle, IconBuilding, IconClock, IconDownload, IconFileAnalytics, IconRefresh, IconRocket, IconTrendingUp, IconWallet } from "@tabler/icons-react";

type ReportData = any;
const moduleLabel: Record<string,string>={EXCHANGE:"Câmbio",BANK_STATEMENT:"Extratos",ACQUIRER:"Adquirentes",CREDIT_CARD_INVOICE:"Faturas",BRASILMED_RECONCILIATION:"BrasilMed"};
const statusLabel: Record<string,string>={UPLOADED:"Enviado",PROCESSING:"Processando",REVIEW:"Em revisão",VALIDATED:"Validado",EXPORTED:"Exportado",FAILED:"Falhou"};
const statusColor: Record<string,string>={UPLOADED:"gray",PROCESSING:"blue",REVIEW:"orange",VALIDATED:"cyan",EXPORTED:"green",FAILED:"red"};
const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(v||0);
const date=(v:string)=>new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v));

export default function RelatoriosPage(){
 const [period,setPeriod]=useState("30d"); const [data,setData]=useState<ReportData|null>(null); const [loading,setLoading]=useState(true); const [error,setError]=useState("");
 async function load(){setLoading(true);setError("");try{const r=await fetch(`/api/reports?period=${period}`,{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Falha ao carregar.");setData(j);}catch(e){setError(e instanceof Error?e.message:"Falha ao carregar relatórios.");}finally{setLoading(false);}}
 useEffect(()=>{void load();},[period]);
 const maxModule=useMemo(()=>Math.max(...(data?.byModule||[]).map((x:any)=>x.total),1),[data]);
 function exportCsv(){if(!data)return;const rows=[["Arquivo","Módulo","Status","Cliente","Usuário","Data","Diferença"],...data.recent.map((i:any)=>[i.name,moduleLabel[i.module]||i.module,statusLabel[i.status]||i.status,i.client||"",i.user,date(i.createdAt),String(i.difference).replace(".",",")])];const csv=rows.map((r:any[])=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}));a.download=`relatorio_fortuno_hub_${period}.csv`;a.click();URL.revokeObjectURL(a.href);}
 if(loading&&!data)return <Center mih={420}><Stack align="center"><Loader/><Text c="dimmed">Consolidando dados operacionais...</Text></Stack></Center>;
 return <Stack gap="xl">
  <Group justify="space-between" align="flex-end"><Stack gap={4}><Text size="xs" fw={800} c="blue" tt="uppercase">Inteligência operacional</Text><Title order={2}>Relatórios</Title><Text c="dimmed">Indicadores reais de importações, equipe, clientes e implantações.</Text></Stack><Group><Select w={180} data={[{value:"7d",label:"Últimos 7 dias"},{value:"30d",label:"Últimos 30 dias"},{value:"90d",label:"Últimos 90 dias"},{value:"year",label:"Ano atual"}]} value={period} onChange={v=>setPeriod(v||"30d")}/><Button variant="default" leftSection={<IconRefresh size={17}/>} onClick={load} loading={loading}>Atualizar</Button><Button leftSection={<IconDownload size={17}/>} onClick={exportCsv} disabled={!data}>Exportar CSV</Button></Group></Group>
  {error&&<Alert color="red" icon={<IconAlertTriangle size={18}/>}>{error}</Alert>}
  {data&&<>
   <SimpleGrid cols={{base:1,sm:2,xl:4}}>
    <Card withBorder radius="lg"><ThemeIcon variant="light" size={42}><IconFileAnalytics size={22}/></ThemeIcon><Text size="sm" c="dimmed" mt="md">Processamentos</Text><Text fw={800} fz={28}>{data.summary.totalImports}</Text><Text size="xs" c="dimmed">{data.summary.successful} concluídos com sucesso</Text></Card>
    <Card withBorder radius="lg"><ThemeIcon variant="light" color="orange" size={42}><IconAlertTriangle size={22}/></ThemeIcon><Text size="sm" c="dimmed" mt="md">Pendências e falhas</Text><Text fw={800} fz={28}>{data.summary.pending+data.summary.failed}</Text><Text size="xs" c="dimmed">{data.summary.failed} falhas no período</Text></Card>
    <Card withBorder radius="lg"><ThemeIcon variant="light" color="teal" size={42}><IconRocket size={22}/></ThemeIcon><Text size="sm" c="dimmed" mt="md">Onboardings ativos</Text><Text fw={800} fz={28}>{data.summary.activeOnboardings}</Text><Text size="xs" c="dimmed">{data.summary.overdueOnboardings} atrasados · {data.summary.onboardingHours}h registradas</Text></Card>
    <Card withBorder radius="lg"><ThemeIcon variant="light" color="grape" size={42}><IconBuilding size={22}/></ThemeIcon><Text size="sm" c="dimmed" mt="md">Clientes ativos</Text><Text fw={800} fz={28}>{data.summary.activeClients}</Text><Text size="xs" c="dimmed">Base operacional atual</Text></Card>
   </SimpleGrid>
   <SimpleGrid cols={{base:1,xl:2}}>
    <Paper withBorder radius="lg" p="lg"><Stack gap="lg"><Group justify="space-between"><Title order={4}>Processamentos por módulo</Title><ThemeIcon variant="light"><IconTrendingUp size={19}/></ThemeIcon></Group>{data.byModule.length?data.byModule.map((i:any)=><Stack key={i.name} gap={5}><Group justify="space-between"><Text fw={700}>{moduleLabel[i.name]||i.name}</Text><Text fw={800}>{i.total}</Text></Group><Progress value={i.total/maxModule*100} radius="xl"/></Stack>):<Text c="dimmed">Nenhum processamento salvo no período.</Text>}</Stack></Paper>
    <Paper withBorder radius="lg" p="lg"><Stack gap="lg"><Group justify="space-between"><Title order={4}>Volume financeiro convertido</Title><ThemeIcon variant="light" color="green"><IconWallet size={19}/></ThemeIcon></Group><Card withBorder><Text size="xs" c="dimmed">Volume total</Text><Text fw={800} fz={26}>{money(data.summary.credits+data.summary.debits)}</Text></Card><SimpleGrid cols={2}><Card withBorder><Text size="xs" c="dimmed">Entradas</Text><Text fw={800} c="green">{money(data.summary.credits)}</Text></Card><Card withBorder><Text size="xs" c="dimmed">Saídas</Text><Text fw={800} c="red">{money(data.summary.debits)}</Text></Card></SimpleGrid></Stack></Paper>
   </SimpleGrid>
   <SimpleGrid cols={{base:1,xl:2}}><Paper withBorder radius="lg" p="lg"><Stack gap="lg"><Title order={4}>Desempenho por usuário</Title>{data.byUser.length?data.byUser.map((i:any,index:number)=><Group key={i.name} justify="space-between"><Group><Badge variant="light">#{index+1}</Badge><Text fw={700}>{i.name}</Text></Group><Text fw={800}>{i.total}</Text></Group>):<Text c="dimmed">Sem dados no período.</Text>}</Stack></Paper><Paper withBorder radius="lg" p="lg"><Stack gap="lg"><Title order={4}>Situação dos processamentos</Title>{data.byStatus.map((i:any)=><Group key={i.name} justify="space-between"><Badge color={statusColor[i.name]} variant="light">{statusLabel[i.name]||i.name}</Badge><Text fw={800}>{i.total}</Text></Group>)}</Stack></Paper></SimpleGrid>
   <Paper withBorder radius="lg"><Group p="lg" justify="space-between"><Stack gap={2}><Title order={4}>Detalhamento recente</Title><Text size="sm" c="dimmed">Dados persistidos pelas telas de importação.</Text></Stack><ThemeIcon variant="light"><IconClock size={19}/></ThemeIcon></Group><ScrollArea><Table miw={900} verticalSpacing="sm"><Table.Thead><Table.Tr><Table.Th>Arquivo</Table.Th><Table.Th>Módulo</Table.Th><Table.Th>Cliente</Table.Th><Table.Th>Usuário</Table.Th><Table.Th>Data</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{data.recent.map((i:any)=><Table.Tr key={i.id}><Table.Td fw={700}>{i.name}</Table.Td><Table.Td>{moduleLabel[i.module]||i.module}</Table.Td><Table.Td>{i.client||"Sem cliente"}</Table.Td><Table.Td>{i.user}</Table.Td><Table.Td>{date(i.createdAt)}</Table.Td><Table.Td><Badge color={statusColor[i.status]} variant="light">{statusLabel[i.status]||i.status}</Badge></Table.Td></Table.Tr>)}</Table.Tbody></Table></ScrollArea></Paper>
  </>}
 </Stack>;
}
