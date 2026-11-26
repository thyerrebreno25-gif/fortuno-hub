import type {jsPDF} from "jspdf";
import {reportDuration,type OperatorDayReport} from "./operator-report-model";
import {executiveReportData,executiveTotals} from "./executive-report-model";
import {serviceMinutes} from "./operator-service-attention";
type Color=[number,number,number];
const navy:Color=[23,48,78],muted:Color=[103,119,138],blue:Color=[35,132,223],teal:Color=[13,163,126],orange:Color=[202,133,45];
export function drawOperatorPdfOverview(doc:jsPDF,report:OperatorDayReport,header:()=>void){
 const data=executiveReportData(report),m=executiveTotals(data),service=report.kind==="SERVICE",a=report.available;
 const clean=(s:string)=>s.replace(/[\u2010-\u2015]/g,"-").replace(/\p{Extended_Pictographic}/gu,"");
 function label(s:string,x:number,y:number,size=9,color:Color=navy,bold=false){doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);doc.text(clean(s),x,y);}
 function fit(s:string,w:number,size=9){doc.setFontSize(size);let t=clean(s);while(doc.getTextWidth(t)>w)t=t.slice(0,-1);return t===clean(s)?t:t.slice(0,-3)+"...";}
 function wrap(s:string,x:number,y:number,w:number,size=9){doc.setFont("helvetica","normal");doc.setFontSize(size);const lines=doc.splitTextToSize(clean(s),w) as string[];lines.forEach((line,i)=>label(line,x,y+i*4.5,size,muted));}
 function title(s:string,sub:string){header();label(s,16,43,22,navy,true);label(fit(sub,178),16,52,9,muted);}
 function metrics(items:Array<[string,string,Color]>,y:number){items.forEach(([name,value,color],i)=>{const x=16+i*45.5;doc.setDrawColor(222,231,240);doc.line(x,y,x+39,y);label(value,x,y+13,value.length>9?14:22,color,true);wrap(name,x,y+21,39,8);});}
 function ranking(title:string,items:Array<{name:string;value:number}>,y:number,color:Color){label(title,16,y,12,navy,true);const sorted=items.slice().sort((a,b)=>b.value-a.value),max=Math.max(1,...sorted.map(p=>p.value));sorted.slice(0,7).forEach((p,i)=>{const yy=y+14+i*10;label(fit(p.name,58,8),16,yy,8);doc.setFillColor(233,239,246);doc.roundedRect(79,yy-3,96,2.5,1,1,"F");if(p.value){doc.setFillColor(...color);doc.roundedRect(79,yy-3,96*p.value/max,2.5,1,1,"F");}label(String(p.value),185,yy,9,color,true);});label("Relação completa a partir da página 3.",16,y+92,8,muted);}
 title(service?"O atendimento em foco.":"Como a operação rodou.",report.scope+" | "+report.day.split("-").reverse().join("/")+" | Brasília");
 if(!service){
  label(m.rate===null?m.tasks+" atividades concluídas.":m.rate+"% da programação entregue.",16,77,20,blue,true);
  wrap(m.planned===null?"Volume de conclusões registradas no dia, inclusive atividades de períodos anteriores.":`${m.delivered} entregas de ${m.planned} programadas. ${m.left} ficaram pendentes no fechamento.`+(m.unknown?` ${m.unknown} sem histórico suficiente para aferição.`:""),16,87,175,10);
  metrics([["ATIVIDADES CONCLUÍDAS",a.operations?String(m.tasks):"-",teal],["ENTREGAS DAILY",a.daily?String(m.daily):"-",blue],["TEMPO CONFIRMADO",a.operations?reportDuration(m.seconds)+" h":"-",navy],["PENDENTES NO FECHAMENTO",m.planned===null?"-":String(m.left),orange]],108);
  ranking("Execução por colaborador",data.people.map(p=>({name:p.name,value:p.tasks})),155,teal);
  wrap(`${m.pendingTasks} tarefas e ${m.pendingDaily} Daily continuam pendentes na geração. Programação: estados até o encerramento do dia. Pendências atuais podem mudar depois.`,16,259,178,8);
 }else{
  const s=data.service;
  metrics([["EM ABERTO",String(m.open),blue],["NA FILA",s?String(s.queue):"-",orange],["RESPOSTA MÉDIA",serviceMinutes(m.response),teal],["RESOLUÇÃO MÉDIA",serviceMinutes(s?.resolution),navy]],73);
  ranking("Carga de atendimento por colaborador",data.people.map(p=>({name:p.name,value:p.open})),128,blue);
  wrap(`Espera na fila: média ${serviceMinutes(s?.queueMean)} | maior ${serviceMinutes(s?.queueMax)}. ${data.attention.length} chamados listados para conferência. Tempos corridos, posição na geração.`,16,247,178,10);
 }
 doc.addPage();title(service?"Voz do cliente e pontos de atenção.":"Atendimento, clientes e reuniões.","Leitura tática | Detalhamento a partir da página 3");
 const s=data.service,feedback=data.feedback.filter(f=>new Date(f.answeredAt).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"})===data.feedbackDay),score=feedback.length?feedback.reduce((n,f)=>n+f.score,0)/feedback.length:null;
 metrics([["MENSAGENS ENVIADAS",a.whatsapp?String(m.messages):"-",blue],["FINALIZAÇÕES",a.whatsapp?String(m.resolved):"-",teal],["EM ABERTO",a.whatsapp?String(m.open):"-",orange],["RESPOSTA MÉDIA",a.whatsapp?serviceMinutes(m.response):"-",navy]],69);
 label("Atendimento que pede atenção",16,119,13,navy,true);
 wrap(`${data.attention.length} chamados listados para conferir. Fila: ${s?.queue??"-"} aguardando. Maior espera: ${serviceMinutes(s?.queueMax)}.`,16,130,178,10);
 wrap("Alertas indicam necessidade de conferência; não presumem falha do colaborador. Chamados em aberto refletem a posição na geração.",16,144,178,8);
 label("Feedbacks dos clientes",16,169,13,navy,true);
 label(score===null?"Sem novas avaliações no dia.":`${feedback.length} novas avaliações | Média ${score.toFixed(1)}/5`,16,181,13,teal,true);
 wrap(`Referência: ${data.feedbackDay.split("-").reverse().join("/")}. O dashboard interativo apresenta todos os feedbacks em cards, incluindo o histórico anterior.`,16,192,178,9);
 if(!service){label("Reuniões e encaminhamentos",16,222,13,navy,true);wrap(a.meetings?`${data.meetings.length} reuniões na data | ${data.meetings.filter(m=>m.status==="COMPLETED").length} marcadas como realizadas | ${data.meetings.reduce((n,m)=>n+m.actions.length,0)} encaminhamentos atribuídos.`:"Indicadores de reuniões indisponíveis neste escopo.",16,234,178,10);}
 wrap("No dashboard, clique na foto para ver o dia de um colaborador; clique novamente para voltar à visão geral. Este PDF preserva o retrato da geração.",16,260,178,8);
 doc.addPage();header();
}
