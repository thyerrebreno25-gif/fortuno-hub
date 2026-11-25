import {jsPDF} from "jspdf";
import autoTable from "jspdf-autotable";
import {reportWordmark} from "@/modules/meetings/report-brand";
import {reportDuration,type OperatorDayReport} from "./operator-report-model";
const clean=(value:string)=>value.normalize("NFC").replace(/[\u2010-\u2015\u2212]/g,"-").replace(/\p{Extended_Pictographic}/gu,"").replace(/[\u0000-\u001f]/g," ");
const quantity=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;
export const operatorPdfName=(day:string)=>`Fortuno-Relatorio-Diario-${day}.pdf`;
export function createOperatorReportPdf(report:OperatorDayReport){
 const doc=new jsPDF({unit:"mm",format:"a4"}),width=210,height=297,left=16,usable=178;
 doc.setProperties({title:`Relatório diário | Fortuno | ${report.day}`,author:"Fortuno",creator:"Fortuno Hub"});doc.setCreationDate(new Date(report.generatedAt));
 const date=report.day.split("-").reverse().join("/"),sum=(key:"messages"|"tasksCompleted"|"dailyCompleted"|"seconds")=>report.rows.reduce((total,row)=>total+row[key],0);
 const header=()=>{doc.setFillColor(15,39,70);doc.rect(0,0,width,28,"F");doc.addImage(reportWordmark,"PNG",left,7,49,9.6,"fortuno-report-wordmark");doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(255);doc.text("RELATÓRIO DIÁRIO",width-left,12,{align:"right"});doc.setFont("helvetica","normal");doc.setFontSize(9);doc.text(date+" | Brasília",width-left,19,{align:"right"});};
 let y=39;header();
 function text(value:string,size=9,bold=false,color:[number,number,number]=[32,50,73]){doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);const lines=doc.splitTextToSize(clean(value),usable) as string[];for(const line of lines){if(y+size*.5>277){doc.addPage();header();y=39;}doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(...color);doc.text(line,left,y);y+=size*.48;}y+=2;}
 text("A operação do dia, por colaborador",17,true);text(report.scope,10);text("Referência: "+date+" | Gerado em "+new Date(report.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}),8,false,[103,119,138]);
 const cards=[{title:"MENSAGENS ENVIADAS",value:report.available.whatsapp?String(sum("messages")):"-",color:[35,132,223]},{title:"TAREFAS CONCLUÍDAS",value:report.available.operations?String(sum("tasksCompleted")):"-",color:[13,163,126]},{title:"ENTREGAS DAILY",value:report.available.daily?String(sum("dailyCompleted")):"-",color:[112,80,190]},{title:"TEMPO CONFIRMADO",value:report.available.operations?reportDuration(sum("seconds"))+" h":"-",color:[20,133,156]}];
 y+=3;cards.forEach((card,index)=>{const x=left+index*45.5;doc.setFillColor(243,247,251);doc.roundedRect(x,y,41.5,23,2,2,"F");doc.setTextColor(94,112,131);doc.setFont("helvetica","bold");doc.setFontSize(6.8);doc.text(card.title,x+3,y+6);doc.setTextColor(card.color[0],card.color[1],card.color[2]);doc.setFontSize(18);doc.text(card.value,x+3,y+16);});y+=33;
 text("Atendimento pelo WhatsApp",12,true);
 const table=(head:string[],body:string[][])=>{autoTable(doc,{startY:y,head:[head],body,margin:{left,right:left,top:37,bottom:22},styles:{font:"helvetica",fontSize:8.5,cellPadding:3,overflow:"linebreak",textColor:[32,50,73],lineWidth:0},headStyles:{fillColor:[228,237,247],textColor:[31,61,95],fontStyle:"bold",fontSize:8},alternateRowStyles:{fillColor:[246,249,252]},columnStyles:{0:{cellWidth:51,fontStyle:"bold"}},rowPageBreak:"avoid",didDrawPage:header});y=(doc as jsPDF&{lastAutoTable:{finalY:number}}).lastAutoTable.finalY+8;};
 if(report.available.whatsapp&&report.rows.length)table(["Colaborador","Mensagens","Conversas","Clientes","Finalizações","Em aberto"],report.rows.map(row=>[clean(row.name),String(row.messages),String(row.conversations),String(row.clients),String(row.resolved),String(row.openCalls)]));
 else text(report.available.whatsapp?"Nenhum operador neste escopo.":"Indicadores de WhatsApp indisponíveis neste escopo.");
 text("Mensagens e finalizações são os registros do dia. Conversas e clientes movimentados são contados por colaborador; a mesma conversa pode envolver mais de uma pessoa.",8,false,[103,119,138]);
 text("Chamados em aberto mostram a situação na geração, entre os recebidos até o dia de referência. Novas atualizações no Hub podem alterar as pendências.",8,false,[103,119,138]);
 for(const warning of report.warnings)text(warning,9,true,[151,91,18]);
 doc.addPage();header();y=40;text("Tarefas, Daily e tempo registrado",16,true);text("Produção do dia e pendências para acompanhamento da gestão.",9);y+=3;
 if(report.rows.length&&(report.available.operations||report.available.daily)){
  const number=(value:number,allowed:boolean)=>allowed?String(value):"-";
  table(["Colaborador","Tarefas\nconcluídas","Tarefas\npendentes","Daily\nentregues","Daily\npendentes","Tempo\nconfirmado"],report.rows.map(row=>[clean(row.name),number(row.tasksCompleted,report.available.operations),number(row.tasksPending,report.available.operations),number(row.dailyCompleted,report.available.daily),number(row.dailyPending,report.available.daily),report.available.operations?reportDuration(row.seconds)+" h":"-"]));
 }else text("Nenhuma atividade disponível neste escopo.");
 text("Pontos para acompanhar",12,true);
 const attention=report.rows.filter(row=>report.available.operations&&(row.tasksPending||row.openTimers)||report.available.daily&&row.dailyPending||report.available.whatsapp&&row.openCalls);
 if(!attention.length)text("Sem pendências identificadas neste recorte.");
 for(const row of attention){const parts=[report.available.whatsapp&&row.openCalls?quantity(row.openCalls,"chamado aberto","chamados abertos"):null,report.available.operations&&row.tasksPending?quantity(row.tasksPending,"tarefa pendente","tarefas pendentes"):null,report.available.daily&&row.dailyPending?quantity(row.dailyPending,"atividade Daily pendente","atividades Daily pendentes"):null,report.available.operations&&row.openTimers?quantity(row.openTimers,"cronômetro aberto","cronômetros abertos"):null].filter(Boolean);text(clean(row.name)+": "+parts.join(" | "),9);}
 y+=3;text("Critérios de leitura",10,true);text("Pendências: posição na geração, com prazos até o dia indicado, incluindo prazos originais das atividades Daily prorrogadas. Não representa uma reconstrução do saldo à meia-noite.",8,false,[103,119,138]);text("Tempo confirmado: somente apontamentos encerrados, proporcionais ao período. Cronômetros abertos ficam fora desse total. Conclusões de tarefas são atribuídas ao autor registrado no evento.",8,false,[103,119,138]);text("O documento apresenta indicadores operacionais, sem conteúdo das mensagens ou anexos dos clientes.",8,false,[103,119,138]);
 const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor(217,226,237);doc.line(left,height-15,width-left,height-15);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(103,119,138);doc.text("Fortuno Hub | Uso interno da gestão",left,height-10);doc.text(`Página ${page} de ${pages}`,width-left,height-10,{align:"right"});}
 return doc;
}
