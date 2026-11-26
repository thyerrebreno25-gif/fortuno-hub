"use client";
import {Paper,SimpleGrid,Stack,Text,Group,Badge} from "@mantine/core";
import {operatorVisualMetrics} from "./operator-report-visual-model";
import {reportDuration,type OperatorDayReport} from "./operator-report-model";
import {serviceMinutes} from "./operator-service-attention";
type Bar={id:string;name:string;value:number};
export function OperatorReportVisual({report,onSelect}:{report:OperatorDayReport;onSelect:(id:string)=>void}){
 const m=operatorVisualMetrics(report),a=report.available,service=report.kind==="SERVICE",s=report.serviceSnapshot;
 function chart(title:string,items:Bar[],color:string,format=(n:number)=>String(n)){
  const sorted=[...items].sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,"pt-BR")),rows=sorted.slice(0,8),max=Math.max(1,...rows.map(row=>row.value));
  return <Paper withBorder radius="lg" p="lg"><Text fw={750} size="lg">{title}</Text><Text size="xs" c="dimmed" mb="md">{rows.length} de {items.length} pessoas · clique para detalhar</Text><Stack gap="xs">{rows.map(row=><button key={row.id} type="button" aria-label={`Filtrar por ${row.name}`} title={`${row.name}: ${format(row.value)}`} onClick={()=>onSelect(row.id)} style={{background:"var(--mantine-color-default-hover)",border:"1px solid var(--mantine-color-default-border)",borderRadius:8,padding:"10px 12px",textAlign:"left",color:"inherit",cursor:"pointer"}}><Group justify="space-between" gap="xs"><Text size="sm" fw={600} truncate>{row.name}</Text><Text size="sm" fw={750}>{format(row.value)}</Text></Group><div style={{height:5,marginTop:8,background:"var(--mantine-color-default-border)",borderRadius:8}}><div style={{height:"100%",borderRadius:8,width:`${100*row.value/max}%`,background:color}}/></div></button>)}{!rows.length&&<Text c="dimmed" size="sm">Sem dados disponíveis neste recorte.</Text>}</Stack></Paper>;
 }
 const labels:Record<string,string>={NEW:"Na fila",IN_PROGRESS:"Em atendimento",WAITING_CUSTOMER:"Aguardando cliente"},colors=["#ed9a31","#2384df","#0da37e","#7555bf"];
 const total=s?.byStatus.reduce((n,row)=>n+row.count,0)||0;
 const gradient=s?.byStatus.map((row,index)=>{const start=100*s.byStatus.slice(0,index).reduce((n,item)=>n+item.count,0)/Math.max(1,total),end=start+100*row.count/Math.max(1,total);return `${colors[index%colors.length]} ${start}% ${end}%`;}).join(",");
 const cards=service?[
  {label:"Chamados abertos",value:a.whatsapp?m.open:"—",color:"blue",note:s?"Posição na geração":"Atribuídos no recorte"},
  {label:"Na fila",value:a.whatsapp&&s?s.queue:"—",color:"orange",note:"Aguardando atendimento"},
  {label:"Resposta média",value:a.whatsapp?serviceMinutes(m.response):"—",color:"teal",note:`${m.responseSamples} rodadas respondidas`},
  {label:"Satisfação",value:a.whatsapp&&s?.satisfaction!=null?s.satisfaction.toFixed(1)+"/5":"—",color:"violet",note:`${s?.satisfactionSamples??0} avaliações em 30 dias`},
 ]:[
  {label:"Tarefas pendentes",value:a.operations?m.pendingTasks:"—",color:"orange",note:"Prazo até a referência"},
  {label:"Daily pendentes",value:a.daily?m.pendingDaily:"—",color:"violet",note:"Inclui prazo original"},
  {label:"Chamados abertos",value:a.whatsapp?m.open:"—",color:"blue",note:s?"Posição na geração":"Atribuídos no recorte"},
  {label:"Tempo confirmado",value:a.operations?reportDuration(m.seconds)+" h":"—",color:"teal",note:"Apontamentos encerrados"},
 ];
 return <Stack gap="md"><SimpleGrid cols={{base:2,md:4}}>{cards.map(card=><Paper withBorder p="lg" radius="lg" key={card.label}><Text size="sm" c="dimmed">{card.label}</Text><Text fz={32} fw={800} c={card.color}>{card.value}</Text><Text size="xs" c="dimmed">{card.note}</Text></Paper>)}</SimpleGrid>
  <SimpleGrid cols={{base:1,lg:2}}>
   {chart(service?"Carga de atendimento":"Pendências por colaborador",report.rows.filter(()=>service?a.whatsapp:a.operations||a.daily).map(row=>({id:row.userId,name:row.name,value:service?row.openCalls:(a.operations?row.tasksPending:0)+(a.daily?row.dailyPending:0)})),service?"#2384df":"#ed9a31")}
   <Paper withBorder radius="lg" p="lg"><Text fw={750} size="lg">Situação dos chamados</Text><Text size="xs" c="dimmed">Posição na geração · tempos corridos</Text>{a.whatsapp&&s?<><div role="img" aria-label={`${s.open} chamados em aberto por situação`} style={{width:190,height:190,borderRadius:"50%",background:total?`conic-gradient(${gradient})`:"var(--mantine-color-default-border)",margin:"24px auto",padding:24}}><div style={{borderRadius:"50%",height:"100%",background:"var(--mantine-color-body)",display:"grid",placeContent:"center",textAlign:"center"}}><Text fz={32} fw={800}>{s.open}</Text><Text size="xs" c="dimmed">em aberto</Text></div></div><Stack gap="xs">{s.byStatus.map((row,index)=><Group justify="space-between" key={row.name}><Group gap="xs"><span style={{width:9,height:9,borderRadius:"50%",background:colors[index%colors.length]}}/><Text size="sm">{labels[row.name]||row.name}</Text></Group><Text fw={700}>{row.count}</Text></Group>)}</Stack><Group mt="md"><Badge variant="light">Espera média: {serviceMinutes(s.averageQueueMinutes)}</Badge><Badge variant="light" color="orange">Maior: {serviceMinutes(s.longestQueueMinutes)}</Badge></Group></>:<Text size="sm" c="dimmed" mt="xl">Distribuição por situação indisponível neste recorte. Consulte os detalhes por colaborador.</Text>}</Paper>
   {chart("Mensagens enviadas",a.whatsapp?report.rows.map(row=>({id:row.userId,name:row.name,value:row.messages})):[],"#2384df")}
   {chart(service?"Tempo médio de resposta":"Entregas realizadas no dia",service?(a.whatsapp?report.rows.filter(row=>row.service?.responseSamples).map(row=>({id:row.userId,name:row.name,value:row.service!.averageResponseMinutes!})):[]):report.rows.filter(()=>a.operations||a.daily).map(row=>({id:row.userId,name:row.name,value:(a.operations?row.tasksCompleted:0)+(a.daily?row.dailyCompleted:0)})),service?"#ed9a31":"#0da37e",service?serviceMinutes:undefined)}
  </SimpleGrid><Text size="xs" c="dimmed">Gráficos em ordem decrescente. Pendências e chamados são a posição na geração; entregas e mensagens pertencem ao dia selecionado. Sem amostra não significa tempo zero. A relação completa aparece abaixo.</Text>
 </Stack>;
}
