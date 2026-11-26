import {expect,it} from "vitest";
import {createOperatorReportPdf,operatorPdfName} from "./operator-report-pdf";
import type {OperatorDayReport} from "./operator-report-model";
import {summarizeOperatorService} from "./operator-service-attention";
const names=["João Gonçalves","Ana Paula","Mariana Souza","Paulo César","Carolina Lima","Lucas Almeida","Beatriz Rocha","Rafael Santos"];
const report:OperatorDayReport={day:"2026-11-24",generatedAt:"2026-11-25T11:00:00Z",scope:"Prévia ilustrativa - dados fictícios",available:{whatsapp:true,operations:true,daily:true},warnings:[],rows:names.map((name,index)=>({userId:String(index),name,leader:"Gestão",messages:70-index*8,conversations:15-index,clients:8, resolved:10,openCalls:index%3,tasksCompleted:20-index,tasksPending:index%4,dailyCompleted:3,dailyPending:index%2,seconds:9800+index*600,openTimers:index===1?1:0}))};
async function read(doc:ReturnType<typeof createOperatorReportPdf>){const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"),task=pdfjs.getDocument({data:new Uint8Array(doc.output("arraybuffer")),useSystemFonts:true}),pdf=await task.promise;const pages:string[]=[];for(let i=1;i<=pdf.numPages;i++){const content=await (await pdf.getPage(i)).getTextContent();pages.push(content.items.map(item=>"str" in item?item.str:"").join(" "));}await task.destroy();return pages;}
it("generates a branded PDF with all operators, accented names, totals, criteria and page numbers",async()=>{
 const doc=createOperatorReportPdf(report),pages=await read(doc),text=pages.join(" ");expect(pages.length).toBeGreaterThanOrEqual(3);for(const name of names)expect(text).toContain(name);expect(text).toContain("24/11/2026");expect(text).toContain("TEMPO CONFIRMADO");expect(text).toContain("Pendências até o dia de referência");expect(text).toContain("Cronômetros abertos ficam fora");
 pages.forEach((page,index)=>{expect(page).toContain("RELATÓRIO DIÁRIO");expect(page).toContain(`Página ${index+1} de ${pages.length}`);});expect(operatorPdfName(report.day)).toBe("Fortuno-Relatorio-Diario-2026-11-24.pdf");
 if(process.env.FORTUNO_OPERATOR_PDF_QA){const fs=await import("node:fs/promises");await fs.mkdir(process.env.FORTUNO_OPERATOR_PDF_QA,{recursive:true});await fs.writeFile(process.env.FORTUNO_OPERATOR_PDF_QA+"/previa-relatorio-diario-fortuno.pdf",Buffer.from(doc.output("arraybuffer")));}
});
it("paginates large teams without dropping the final operator or long wrapped names",async()=>{
 const doc=createOperatorReportPdf({...report,rows:Array.from({length:45},(_,index)=>({...report.rows[index%8],name:index===44?"ÚLTIMO OPERADOR PRESERVADO":"Nome completo de colaborador para teste de quebra de linha "+index}))});const pages=await read(doc);expect(pages.length).toBeGreaterThan(3);expect(pages.join(" ")).toContain("ÚLTIMO OPERADOR PRESERVADO");
});
it("does not export the metrics of modules without access",async()=>{
 const pages=await read(createOperatorReportPdf({...report,available:{whatsapp:false,operations:false,daily:false}}));expect(pages.join(" ")).not.toContain("João Gonçalves");expect(pages.join(" ")).toContain("indisponíveis");
});
it("exports response delays and factual closure reviews with affected clients and operators",async()=>{
 const now=new Date(report.generatedAt),ago=(minutes:number)=>new Date(+now-minutes*60000),service=summarizeOperatorService(report.rows.map((row,index)=>({...row,resolved:index===0?0:row.resolved})),[
 {id:"pending",userId:"0",client:"Cliente Exemplo A",contact:"Grupo de atendimento",status:"IN_PROGRESS",openedAt:ago(900),lastOutboundAt:ago(300),pendingSince:ago(120)},
 {id:"review",userId:"0",client:"Cliente Exemplo B",contact:"Documentos",status:"IN_PROGRESS",openedAt:ago(600),lastOutboundAt:ago(90),pendingSince:null},
 {id:"waiting",userId:"1",client:"Cliente Exemplo C",contact:"Contas a pagar",status:"WAITING_CUSTOMER",openedAt:ago(1500),lastOutboundAt:ago(200),pendingSince:null},
 ],[{userId:"0",minutes:15},{userId:"0",minutes:75}],now);
 const enriched={...report,rows:report.rows.map((row,index)=>({...row,resolved:index===0?0:row.resolved,service:service.metrics.get(row.userId)})),serviceAttention:service.attention},doc=createOperatorReportPdf(enriched),pages=await read(doc),text=pages.join(" ");expect(pages.length).toBeGreaterThan(2);for(const page of pages)expect(page).toContain("RELATÓRIO DIÁRIO");for(const phrase of ["Pontos de atenção no atendimento","Cliente Exemplo A","Revisar finalização","Sem finalizações registradas no dia","45 min"])expect(text).toContain(phrase);expect(text).not.toContain("Cliente Exemplo C");expect(text).not.toContain("não estão finalizando");
 if(process.env.FORTUNO_OPERATOR_PDF_QA){const fs=await import("node:fs/promises");await fs.mkdir(process.env.FORTUNO_OPERATOR_PDF_QA,{recursive:true});await fs.writeFile(process.env.FORTUNO_OPERATOR_PDF_QA+"/previa-relatorio-com-alertas.pdf",Buffer.from(doc.output("arraybuffer")));}
});

it("places yesterday's pending work first and creates an independent service-only PDF",async()=>{
 const enriched:OperatorDayReport={...report,pendingWork:[{id:"pending",userId:"0",title:"Conciliação pendente prioritária",client:"Cliente Exemplo",dueAt:"2026-11-24T21:00Z",kind:"TASK",status:"OPEN"}],rows:report.rows.map((r,i)=>({...r,tasksPending:i===0?1:r.tasksPending})),serviceSnapshot:{open:14,clients:7,queue:3,averageQueueMinutes:18,longestQueueMinutes:41,averageResolutionMinutes:52,resolutionSamples:10,satisfaction:4.7,satisfactionSamples:6,byStatus:[{name:"NEW",count:3},{name:"IN_PROGRESS",count:11}],bySector:[{name:"Contas a pagar",count:14}],openClients:[{name:"Cliente Exemplo",count:2}]}};
 const general=createOperatorReportPdf(enriched),generalPages=await read(general),text=generalPages.join(" ");
 expect(generalPages[0]).toContain("Como a operação rodou.");expect(text.indexOf("Conciliação pendente prioritária")).toBeLessThan(text.indexOf("Atendimento por colaborador"));
 expect(generalPages[0]).toContain("Execução por colaborador");expect(generalPages[1]).toContain("Atendimento, clientes e reuniões.");
 expect(generalPages.slice(0,2).join(" ")).not.toContain("Conciliação pendente prioritária");expect(generalPages.slice(2).join(" ")).toContain("Conciliação pendente prioritária");
 const service=createOperatorReportPdf({...enriched,kind:"SERVICE",available:{whatsapp:true,operations:false,daily:false}}),serviceText=(await read(service)).join(" ");
 for(const value of ["RELATÓRIO DE ATENDIMENTO","3 na fila","Contas a pagar","Cliente Exemplo"])expect(serviceText).toContain(value);
 expect(serviceText).not.toContain("Conciliação pendente prioritária");expect(serviceText).not.toContain("Tarefas, Daily e tempo registrado");expect(operatorPdfName(report.day,"SERVICE")).toContain("Atendimento");
 if(process.env.FORTUNO_OPERATOR_PDF_QA){const fs=await import("node:fs/promises");await fs.mkdir(process.env.FORTUNO_OPERATOR_PDF_QA,{recursive:true});await fs.writeFile(process.env.FORTUNO_OPERATOR_PDF_QA+"/previa-geral-pendencias-primeiro.pdf",Buffer.from(general.output("arraybuffer")));await fs.writeFile(process.env.FORTUNO_OPERATOR_PDF_QA+"/previa-atendimento-13h.pdf",Buffer.from(service.output("arraybuffer")));}
});
