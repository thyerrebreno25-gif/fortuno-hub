import type {jsPDF} from "jspdf";
import {reportDuration,type OperatorDayReport} from "./operator-report-model";
import {operatorVisualMetrics} from "./operator-report-visual-model";
import {serviceMinutes} from "./operator-service-attention";
type Color=[number,number,number];
const navy:Color=[23,48,78],muted:Color=[103,119,138],blue:Color=[35,132,223],teal:Color=[13,163,126],orange:Color=[226,124,24],purple:Color=[117,85,191];
export function drawOperatorPdfOverview(doc:jsPDF,report:OperatorDayReport,header:()=>void){
 const service=report.kind==="SERVICE",m=operatorVisualMetrics(report),a=report.available,snapshot=report.serviceSnapshot;
 function label(value:string,x:number,y:number,size=9,color:Color=navy,bold=false){doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);doc.text(value.replace(/[\u2010-\u2015]/g,"-").replace(/\p{Extended_Pictographic}/gu,"").replace(/[\u0000-\u001f]/g," "),x,y);}
 function fit(value:string,width:number,size=8){doc.setFontSize(size);let result=value;while(result.length&&doc.getTextWidth(result)>width)result=result.slice(0,-1);return result===value?result:result.slice(0,-3)+"...";}
 function wrapped(value:string,x:number,y:number,width:number,size=8,color:Color=muted){doc.setFont("helvetica","normal");doc.setFontSize(size);const lines=doc.splitTextToSize(value,width) as string[];lines.forEach((line,i)=>label(line,x,y+i*4,size,color));}
 function panel(x:number,y:number,w:number,h:number,title:string,subtitle?:string){doc.setFillColor(247,249,252);doc.setDrawColor(224,231,240);doc.roundedRect(x,y,w,h,3,3,"FD");label(title,x+5,y+8,10,navy,true);if(subtitle)wrapped(subtitle,x+5,y+14,w-10,7.5);}
 function cards(items:Array<{title:string;value:string;note:string;color:Color}>){items.forEach((item,i)=>{const x=16+i*45.5;doc.setFillColor(247,249,252);doc.roundedRect(x,64,41.5,29,3,3,"F");doc.setFillColor(...item.color);doc.rect(x,68,1,20,"F");label(item.title,x+4,71,7,muted,true);label(item.value,x+4,82,item.value.length>7?13:20,item.color,true);label(fit(item.note,34,6.8),x+4,89,6.8,muted);});}
 function ranking(x:number,y:number,w:number,h:number,title:string,items:Array<{name:string;value:number}>,color:Color,format=(n:number)=>String(n)){
  const sorted=items.filter(item=>Number.isFinite(item.value)).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,"pt-BR")),top=sorted.slice(0,6),max=Math.max(1,...top.map(item=>item.value));
  panel(x,y,w,h,title,`Maiores valores - ${top.length} de ${sorted.length} pessoas`);
  if(!top.length){wrapped("Sem dados disponíveis neste recorte.",x+5,y+32,w-10,9);return;}
  top.forEach((item,i)=>{const rowY=y+27+i*11;label(fit(item.name,w-27),x+5,rowY,8);doc.setFontSize(8);label(format(item.value),x+w-6-doc.getTextWidth(format(item.value)),rowY,8,color,true);doc.setFillColor(227,234,243);doc.roundedRect(x+5,rowY+2,w-11,2,1,1,"F");if(item.value>0){doc.setFillColor(...color);doc.roundedRect(x+5,rowY+2,(w-11)*item.value/max,2,1,1,"F");}});
 }
 function title(main:string,sub:string){label(main,16,40,18,navy,true);label(fit(report.scope,178,9),16,47,9,muted);label(sub,16,55,8,muted);}
 header();title(service?"Atendimento em uma visão":"Prioridades para começar o dia",service?"Posição na geração do relatório - tempos corridos":"Pendências até o dia de referência");
 cards(service?[
  {title:"EM ABERTO",value:a.whatsapp?String(m.open):"-",note:snapshot?"Posição na geração":"Chamados atribuídos",color:blue},
  {title:"NA FILA",value:a.whatsapp&&snapshot?String(snapshot.queue):"-",note:"Aguardando atendimento",color:orange},
  {title:"RESPOSTA > 30 MIN",value:a.whatsapp&&report.serviceAttention?String(report.serviceAttention.cases.filter(c=>(c.waitingMinutes??0)>=30).length):"-",note:"Casos listados no relatório",color:orange},
  {title:"SATISFAÇÃO",value:a.whatsapp&&snapshot?.satisfaction!=null?snapshot.satisfaction.toFixed(1)+"/5":"-",note:snapshot?`${snapshot.satisfactionSamples} avaliações / 30 dias`:"Sem avaliações disponíveis",color:teal},
 ]:[
  {title:"TAREFAS PENDENTES",value:a.operations?String(m.pendingTasks):"-",note:"Prazo até a referência",color:orange},
  {title:"DAILY PENDENTES",value:a.daily?String(m.pendingDaily):"-",note:"Inclui prazo original",color:purple},
  {title:"CHAMADOS ABERTOS",value:a.whatsapp?String(m.open):"-",note:snapshot?"Posição na geração":"Chamados atribuídos",color:blue},
  {title:"NA FILA",value:a.whatsapp&&snapshot?String(snapshot.queue):"-",note:"Aguardando atendimento",color:orange},
 ]);
 ranking(16,102,85,100,service?"Carga em aberto":"Pendências por pessoa",report.rows.filter(()=>service?a.whatsapp:a.operations||a.daily).map(row=>({name:row.name,value:service?row.openCalls:(a.operations?row.tasksPending:0)+(a.daily?row.dailyPending:0)})),service?blue:orange);
 panel(109,102,85,100,"Situação dos chamados",snapshot?"Posição na geração":"Sem distribuição por situação");
 if(a.whatsapp&&snapshot){
  const statusLabels:Record<string,string>={NEW:"Na fila",IN_PROGRESS:"Em atendimento",WAITING_CUSTOMER:"Aguardando cliente"},colors:Color[]=[orange,blue,teal,purple];
  const rows=snapshot.byStatus.filter(row=>row.count>0),total=rows.reduce((n,row)=>n+row.count,0);let angle=-Math.PI/2;
  doc.setFillColor(226,234,243);doc.circle(151.5,146,20.5,"F");
  rows.forEach((row,index)=>{const end=angle+2*Math.PI*row.count/Math.max(1,total),points:number[][]=[[151.5,146]];for(let t=angle;t<end;t+=.025)points.push([151.5+20.5*Math.cos(t),146+20.5*Math.sin(t)]);points.push([151.5+20.5*Math.cos(end),146+20.5*Math.sin(end)]);doc.setFillColor(...colors[index%colors.length]);doc.lines(points.slice(1).map((point,i)=>[point[0]-points[i][0],point[1]-points[i][1]]),points[0][0],points[0][1],[1,1],"F",true);angle=end;});
  doc.setFillColor(247,249,252);doc.circle(151.5,146,13.5,"F");
  doc.setFont("helvetica","bold");doc.setFontSize(19);label(String(snapshot.open),151.5-doc.getTextWidth(String(snapshot.open))/2,147,19,navy,true);label("em aberto",144,153,7,muted);
  rows.slice(0,4).forEach((row,i)=>{const yy=174+i*6;doc.setFillColor(...colors[i%colors.length]);doc.circle(116,yy-1,1,"F");label(fit(statusLabels[row.name]||row.name,55,8),120,yy,8);label(String(row.count),181,yy,8,navy,true);});
 }else wrapped(a.whatsapp?"Sem dados por situação. Os detalhes por colaborador seguem a partir da página 3.":"Indicadores de WhatsApp indisponíveis neste escopo.",115,137,72,9);
 panel(16,211,178,47,"Foco da gestão");
 const cases=a.whatsapp?report.serviceAttention?.totalCases:undefined;
 const focus=service?`${cases??"-"} chamados sinalizados para conferência. Maior espera na fila: ${serviceMinutes(snapshot?.longestQueueMinutes)}.`:`${a.operations?m.pendingTasks:0} tarefas e ${a.daily?m.pendingDaily:0} entregas Daily pendentes. ${a.operations?m.timers:0} cronômetros abertos, sem tempo confirmado.`;
 wrapped(focus,21,228,166,10,navy);wrapped("Pendências refletem a posição na geração. Alertas de atendimento podem se sobrepor e pedem conferência, sem presumir falha do colaborador.",21,242,166,8);
 if(report.warnings.length)label(fit("Atenção: "+report.warnings[0],178,8),16,268,8,orange);
 doc.addPage();header();title(service?"Ritmo e tempos de atendimento":"Produção e capacidade da equipe","Resumo visual - detalhes e critérios a partir da página 3");
 cards(service?[
  {title:"MENSAGENS",value:a.whatsapp?String(m.messages):"-",note:"Enviadas no período",color:blue},
  {title:"RESPOSTA MÉDIA",value:a.whatsapp?serviceMinutes(m.response):"-",note:`${m.responseSamples} rodadas respondidas`,color:teal},
  {title:"ESPERA NA FILA",value:a.whatsapp?serviceMinutes(snapshot?.averageQueueMinutes):"-",note:"Média na posição atual",color:orange},
  {title:"RESOLUÇÃO MÉDIA",value:a.whatsapp?serviceMinutes(snapshot?.averageResolutionMinutes):"-",note:`${snapshot?.resolutionSamples??0} amostras no período`,color:purple},
 ]:[
  {title:"MENSAGENS",value:a.whatsapp?String(m.messages):"-",note:"Enviadas no dia",color:blue},
  {title:"TAREFAS CONCLUÍDAS",value:a.operations?String(m.tasks):"-",note:"Registradas no dia",color:teal},
  {title:"ENTREGAS DAILY",value:a.daily?String(m.daily):"-",note:"Registradas no dia",color:purple},
  {title:"TEMPO CONFIRMADO",value:a.operations?reportDuration(m.seconds)+" h":"-",note:"Apontamentos encerrados",color:blue},
 ]);
 ranking(16,102,85,100,"Mensagens enviadas",a.whatsapp?report.rows.map(row=>({name:row.name,value:row.messages})):[],blue);
 ranking(109,102,85,100,service?"Tempo médio de resposta":"Entregas no dia",service?(a.whatsapp?report.rows.filter(row=>row.service?.responseSamples).map(row=>({name:row.name,value:row.service!.averageResponseMinutes!})):[]):report.rows.filter(()=>a.operations||a.daily).map(row=>({name:row.name,value:(a.operations?row.tasksCompleted:0)+(a.daily?row.dailyCompleted:0)})),service?orange:teal,service?serviceMinutes:undefined);
 panel(16,211,178,47,"Como aprofundar a leitura");
 wrapped(service?"A partir da página 3: fila, setores, responsáveis, amostras de resposta, clientes em aberto e chamados que precisam de atenção.":"A partir da página 3: pendências por colaborador e cliente, atendimento, alertas e o detalhamento das tarefas, Daily e tempo registrado.",21,228,166,10,navy);
 wrapped("Os gráficos mostram os maiores valores do recorte. A relação completa continua no detalhamento. Sem amostra não significa tempo zero.",21,246,166,8);
 doc.addPage();header();
}
