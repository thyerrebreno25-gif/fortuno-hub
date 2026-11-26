import {jsPDF} from "jspdf";
import autoTable from "jspdf-autotable";
import {reportWordmark} from "@/modules/meetings/report-brand";
import {reportDuration,type OperatorDayReport,type ReportKind} from "./operator-report-model";
import {serviceMinutes} from "./operator-service-attention";
import {drawOperatorPdfOverview} from "./operator-report-pdf-overview";
const clean=(value:string)=>value.normalize("NFC").replace(/[\u2010-\u2015\u2212]/g,"-").replace(/\p{Extended_Pictographic}/gu,"").replace(/[\u0000-\u001f]/g," ");
export const operatorPdfName=(day:string,kind:ReportKind="GENERAL")=>`Fortuno-Relatorio-${kind==="SERVICE"?"Atendimento":"Diario"}-${day}.pdf`;
export function createOperatorReportPdf(report:OperatorDayReport){
 const serviceOnly=report.kind==="SERVICE";
 const doc=new jsPDF({unit:"mm",format:"a4"}),width=210,height=297,left=16,usable=178;
 doc.setProperties({title:`${serviceOnly?"Relatório de atendimento":"Relatório diário"} | Fortuno | ${report.day}`,author:"Fortuno",creator:"Fortuno Hub"});doc.setCreationDate(new Date(report.generatedAt));
 const date=report.day.split("-").reverse().join("/"),sum=(key:"messages"|"tasksCompleted"|"dailyCompleted"|"seconds")=>report.rows.reduce((total,row)=>total+row[key],0);
 const header=()=>{doc.saveGraphicsState();doc.setFillColor(15,39,70);doc.rect(0,0,width,28,"F");doc.addImage(reportWordmark,"PNG",left,7,49,9.6,"fortuno-report-wordmark");doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(255);doc.text(serviceOnly?"RELATÓRIO DE ATENDIMENTO":"RELATÓRIO DIÁRIO",width-left,12,{align:"right"});doc.setFont("helvetica","normal");doc.setFontSize(9);doc.text(date+" | Brasília",width-left,19,{align:"right"});doc.restoreGraphicsState();};
 let y=39;drawOperatorPdfOverview(doc,report,header);
 function text(value:string,size=9,bold=false,color:[number,number,number]=[32,50,73]){doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);const lines=doc.splitTextToSize(clean(value),usable) as string[];for(const line of lines){if(y+size*.5>277){doc.addPage();header();y=39;}doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);doc.text(line,left,y);y+=size*.48;}y+=2;}
 text(serviceOnly?"Panorama de atendimento | 13h":"Operação | produção e pendências",17,true);text(report.scope,10);text("Referência: "+date+" | Gerado em "+new Date(report.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}),8,false,[103,119,138]);

 const table=(head:string[],body:string[][],widths?:number[])=>{autoTable(doc,{startY:y,head:[head],body,margin:{left,right:left,top:37,bottom:22},styles:{font:"helvetica",fontSize:8.5,cellPadding:3,overflow:"linebreak",textColor:[32,50,73],lineWidth:0},headStyles:{fillColor:[228,237,247],textColor:[31,61,95],fontStyle:"bold",fontSize:8},alternateRowStyles:{fillColor:[246,249,252]},columnStyles:{...Object.fromEntries((widths||[]).map((cellWidth,index)=>[index,{cellWidth}])),0:{cellWidth:widths?.[0]||51,fontStyle:"bold"}},rowPageBreak:"avoid",didDrawPage:header});y=(doc as jsPDF&{lastAutoTable:{finalY:number}}).lastAutoTable.finalY+8;};
 if(!serviceOnly){
 if(y>100){doc.addPage();header();y=40;}else y+=6;text("Tarefas, Daily e tempo registrado",16,true); const cards=[{title:"MENSAGENS ENVIADAS",value:report.available.whatsapp?String(sum("messages")):"-",color:[35,132,223]},{title:"TAREFAS CONCLUÍDAS",value:report.available.operations?String(sum("tasksCompleted")):"-",color:[13,163,126]},{title:"ENTREGAS DAILY",value:report.available.daily?String(sum("dailyCompleted")):"-",color:[112,80,190]},{title:"TEMPO CONFIRMADO",value:report.available.operations?reportDuration(sum("seconds"))+" h":"-",color:[20,133,156]}];
 y+=3;cards.forEach((card,index)=>{const x=left+index*45.5;doc.setFillColor(243,247,251);doc.roundedRect(x,y,41.5,23,2,2,"F");doc.setTextColor(94,112,131);doc.setFont("helvetica","bold");doc.setFontSize(6.8);doc.text(card.title,x+3,y+6);doc.setTextColor(card.color[0],card.color[1],card.color[2]);doc.setFontSize(18);doc.text(card.value,x+3,y+16);});y+=33;text("Produção do dia e pendências para acompanhamento da gestão.",9);y+=3;
 if(report.rows.length&&(report.available.operations||report.available.daily)){
  const number=(value:number,allowed:boolean)=>allowed?String(value):"-";
  table(["Colaborador","Tarefas\nconcluídas","Tarefas\npendentes","Daily\nentregues","Daily\npendentes","Tempo\nconfirmado"],report.rows.map(row=>[clean(row.name),number(row.tasksCompleted,report.available.operations),number(row.tasksPending,report.available.operations),number(row.dailyCompleted,report.available.daily),number(row.dailyPending,report.available.daily),report.available.operations?reportDuration(row.seconds)+" h":"-"]));
 }else text("Nenhuma atividade disponível neste escopo.");
 y+=3;text("Critérios de leitura",10,true);text("Pendências: posição na geração, com prazos até o dia indicado, incluindo prazos originais das atividades Daily prorrogadas. Não representa uma reconstrução do saldo à meia-noite.",8,false,[103,119,138]);text("Tempo confirmado: somente apontamentos encerrados, proporcionais ao período. Cronômetros abertos ficam fora desse total. Conclusões de tarefas são atribuídas ao autor registrado no evento.",8,false,[103,119,138]);
 }
 if(!serviceOnly&&(report.available.operations||report.available.daily)){
  if(y>210){doc.addPage();header();y=39;}
  text("Pendências até o dia de referência",12,true);
  text("Posição na geração: inclui pendências anteriores ainda abertas, com prazo até "+date+". Atividades prorrogadas de Daily continuam identificadas pelo prazo original.",8,false,[103,119,138]);

  const pending=report.rows.filter(r=>r.tasksPending||r.dailyPending||r.openTimers).sort((a,b)=>b.tasksPending+b.dailyPending-a.tasksPending-a.dailyPending||a.name.localeCompare(b.name,"pt-BR"));
  if(pending.length)table(["Colaborador","Tarefas pendentes","Daily pendentes","Cronômetros abertos"],pending.map(r=>[clean(r.name),report.available.operations?String(r.tasksPending):"-",report.available.daily?String(r.dailyPending):"-",report.available.operations?String(r.openTimers):"-"]));else text("Sem tarefas ou Daily pendentes neste recorte.");
  for(const row of pending){const items=(report.pendingWork||[]).filter(item=>item.userId===row.userId&&(item.kind==="TASK"?report.available.operations:report.available.daily));if(!items.length)continue;
   if(y>220){doc.addPage();header();y=39;}text(row.name,11,true);table(["Atividade / cliente ou reunião","Origem","Prazo atual"],items.map(item=>[clean(item.title+" | "+item.client),item.kind==="TASK"?"Gestão de tarefas":"Daily",item.dueAt?new Date(item.dueAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}):"Sem prazo"]),[115,28,35]);
  }
  if(y>210){doc.addPage();header();y=39;}else y+=8;
 }
 if(report.available.whatsapp&&report.serviceSnapshot){
  const snapshot=report.serviceSnapshot;text("Atendimento: fila e operação em aberto",14,true);
  text(snapshot.open+" chamados abertos | "+snapshot.clients+" clientes | "+snapshot.queue+" na fila",11,true);
  text("Espera na fila: média "+serviceMinutes(snapshot.averageQueueMinutes)+" | maior "+serviceMinutes(snapshot.longestQueueMinutes),10);
  text("Resolução no período: "+serviceMinutes(snapshot.averageResolutionMinutes)+" ("+snapshot.resolutionSamples+" amostras) | Satisfação nos últimos 30 dias: "+(snapshot.satisfaction===null?"sem avaliações":snapshot.satisfaction.toFixed(1)+"/5")+" ("+snapshot.satisfactionSamples+" avaliações)",9);
  const status:Record<string,string>={NEW:"Na fila",IN_PROGRESS:"Em atendimento",WAITING_CUSTOMER:"Aguardando cliente"};
  table(["Situação","Chamados"],snapshot.byStatus.map(r=>[status[r.name]||r.name,String(r.count)]),[140,38]);
  table(["Setor","Chamados em aberto"],snapshot.bySector.map(r=>[clean(r.name),String(r.count)]),[140,38]);
 }
 text("Atendimento por colaborador",12,true);

 if(report.available.whatsapp&&report.rows.length)table(["Colaborador","Mensagens","Conversas","Clientes","Finalizações","Em aberto"],[...report.rows].sort((a,b)=>b.openCalls-a.openCalls||b.conversations-a.conversations).map(row=>[clean(row.name),String(row.messages),String(row.conversations),String(row.clients),String(row.resolved),String(row.openCalls)]));
 else text(report.available.whatsapp?"Nenhum operador neste escopo.":"Indicadores de WhatsApp indisponíveis neste escopo.");
 text("Mensagens e finalizações são os registros do dia. Conversas e clientes movimentados são contados por colaborador; a mesma conversa pode envolver mais de uma pessoa.",8,false,[103,119,138]);
 text("Chamados em aberto mostram a situação na geração, entre os recebidos até o dia de referência. Novas atualizações no Hub podem alterar as pendências.",8,false,[103,119,138]);
 for(const warning of report.warnings)text(warning,9,true,[151,91,18]);
 if(report.available.whatsapp&&report.serviceAttention){
  const attention=report.serviceAttention,people=report.rows.filter(row=>row.service).sort((a,b)=>b.service!.overdueResponses-a.service!.overdueResponses||b.service!.closureReviewCalls-a.service!.closureReviewCalls||b.service!.longOpenCalls-a.service!.longOpenCalls);
  const total=(key:"overdueResponses"|"longOpenCalls"|"closureReviewCalls"|"waitingCustomerCalls")=>people.reduce((sum,row)=>sum+row.service![key],0);
  doc.addPage();header();y=40;text("Pontos de atenção no atendimento",16,true);text("Posição na geração | tempos corridos | resposta: 30 min | aberto: 8h",8,false,[103,119,138]);
  text(`${total("overdueResponses")} aguardando resposta por 30 min ou mais | ${total("longOpenCalls")} abertos há 8h ou mais`,10,true,[151,91,18]);
  text(`${total("closureReviewCalls")} para revisar finalização | ${total("waitingCustomerCalls")} aguardando o cliente`,9);
  table(["Colaborador","Resposta no dia\nmédia / maior","Sem resposta\n30 min ou mais","Tempo aberto\nmédia / maior","Revisar\nfinalização"],people.map(row=>{const s=row.service!;return [clean(row.name),s.responseSamples?`${serviceMinutes(s.averageResponseMinutes)} / ${serviceMinutes(s.longestResponseMinutes)}\n${s.responseSamples} amostra(s)` : "Sem amostra",`${s.overdueResponses}\nMaior espera: ${serviceMinutes(s.longestWaitMinutes)}`,`${serviceMinutes(s.averageOpenMinutes)} / ${serviceMinutes(s.longestOpenMinutes)}`,String(s.closureReviewCalls)];}));
  text("Respostas: tempo desde a primeira mensagem de cada sequência do cliente até a resposta da equipe, atribuído a quem respondeu. Sem amostra não significa resposta imediata.",8,false,[103,119,138]);
  if(y>242){doc.addPage();header();y=39;}text("Alertas por colaborador",12,true);
  const flagged=people.filter(row=>row.service!.alerts.length);if(!flagged.length)text("Sem alertas nos critérios de atendimento deste recorte.",9);
  for(const row of flagged){if(y>245){doc.addPage();header();y=39;}text(row.name,10,true);for(const alert of row.service!.alerts)text("- "+alert,9);}
  if(attention.cases.length){if(y>220){doc.addPage();header();y=39;}text("Chamados para conferir primeiro",12,true);text(`Exibindo ${attention.cases.length} de ${attention.totalCases} chamado(s) sinalizado(s), por criticidade e espera.`,8,false,[103,119,138]);
   table(["Cliente / conversa","Responsável","Tempo\naberto","Sem\nresposta","Ponto de atenção"],attention.cases.map(item=>[clean(item.client+(item.contact!==item.client?"\n"+item.contact:"")),clean(item.operator),serviceMinutes(item.openMinutes),serviceMinutes(item.waitingMinutes),item.reasons.map(clean).join("\n")]),[47,31,23,23,54]);
  }
  text("Aguardando o cliente, sem nova mensagem pendente, não gera alerta de duração ou revisão de encerramento. Os alertas pedem conferência: não concluem que o serviço terminou ou que houve falha do colaborador.",8,false,[103,119,138]);
 }
 if(report.available.whatsapp&&report.serviceSnapshot?.openClients.length){doc.addPage();header();y=39;text("Clientes com atendimento em aberto",14,true);table(["Cliente","Chamados em aberto"],report.serviceSnapshot.openClients.map(r=>[clean(r.name),String(r.count)]),[140,38]);}

 if(report.available.whatsapp){
 const answers=(report.feedback||[]).filter(f=>new Date(f.answeredAt).toLocaleDateString("en-CA",{timeZone:"America/Sao_Paulo"})===(report.feedbackDay||report.day));
 doc.addPage();header();y=39;text("Feedbacks dos clientes",16,true);text("Avaliações recebidas em "+(report.feedbackDay||report.day).split("-").reverse().join("/"),9);
 if(answers.length)table(["Cliente","Atendimento","Nota","Comentário"],answers.map(f=>[clean(f.client),clean(f.operator),f.score+"/5",clean(f.comment||"Sem comentário")]),[42,38,16,82]);else text("Nenhuma nova avaliação recebida neste dia.");
 }
 if(!serviceOnly&&report.available.meetings){doc.addPage();header();y=39;text("Reuniões e encaminhamentos",16,true);
 for(const meeting of report.meetings||[]){if(y>230){doc.addPage();header();y=39;}text(meeting.title,12,true);text(meeting.responsible+" | "+new Date(meeting.startsAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}),9);
 if(meeting.actions.length)table(["Atividade","Responsável","Prazo","Situação até o dia"],meeting.actions.map(item=>[clean(item.title),clean(report.rows.find(r=>r.userId===item.userId)?.name||"Fora do recorte"),new Date(item.dueAt).toLocaleDateString("pt-BR",{timeZone:"America/Sao_Paulo"}),item.completedAt&&new Date(item.completedAt)<new Date(report.day+"T23:59:59.999-03:00")?"Concluída":"Pendente"]),[72,40,30,36]);}
 if(!report.meetings?.length)text("Nenhuma reunião neste recorte.");
 }
 const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page++){doc.setPage(page);header();doc.setDrawColor(217,226,237);doc.line(left,height-15,width-left,height-15);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(103,119,138);doc.text("Fortuno Hub | Uso interno da gestão",left,height-10);doc.text(`Página ${page} de ${pages}`,width-left,height-10,{align:"right"});}
 return doc;
}
