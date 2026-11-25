import {expect,it} from "vitest";
import {createOperatorReportPdf,operatorPdfName} from "./operator-report-pdf";
import type {OperatorDayReport} from "./operator-report-model";
const names=["João Gonçalves","Ana Paula","Mariana Souza","Paulo César","Carolina Lima","Lucas Almeida","Beatriz Rocha","Rafael Santos"];
const report:OperatorDayReport={day:"2026-11-24",generatedAt:"2026-11-25T11:00:00Z",scope:"Prévia ilustrativa - dados fictícios",available:{whatsapp:true,operations:true,daily:true},warnings:[],rows:names.map((name,index)=>({userId:String(index),name,leader:"Gestão",messages:70-index*8,conversations:15-index,clients:8, resolved:10,openCalls:index%3,tasksCompleted:20-index,tasksPending:index%4,dailyCompleted:3,dailyPending:index%2,seconds:9800+index*600,openTimers:index===1?1:0}))};
async function read(doc:ReturnType<typeof createOperatorReportPdf>){const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"),task=pdfjs.getDocument({data:new Uint8Array(doc.output("arraybuffer")),useSystemFonts:true}),pdf=await task.promise;const pages:string[]=[];for(let i=1;i<=pdf.numPages;i++){const content=await (await pdf.getPage(i)).getTextContent();pages.push(content.items.map(item=>"str" in item?item.str:"").join(" "));}await task.destroy();return pages;}
it("generates a branded PDF with all operators, accented names, totals, criteria and page numbers",async()=>{
 const doc=createOperatorReportPdf(report),pages=await read(doc),text=pages.join(" ");expect(pages).toHaveLength(2);for(const name of names)expect(text).toContain(name);expect(text).toContain("24/11/2026");expect(text).toContain("TEMPO CONFIRMADO");expect(text).toContain("Pontos para acompanhar");expect(text).toContain("Cronômetros abertos ficam fora");
 pages.forEach((page,index)=>{expect(page).toContain("RELATÓRIO DIÁRIO");expect(page).toContain(`Página ${index+1} de ${pages.length}`);});expect(operatorPdfName(report.day)).toBe("Fortuno-Relatorio-Diario-2026-11-24.pdf");
 if(process.env.FORTUNO_OPERATOR_PDF_QA){const fs=await import("node:fs/promises");await fs.mkdir(process.env.FORTUNO_OPERATOR_PDF_QA,{recursive:true});await fs.writeFile(process.env.FORTUNO_OPERATOR_PDF_QA+"/previa-relatorio-diario-fortuno.pdf",Buffer.from(doc.output("arraybuffer")));}
});
it("paginates large teams without dropping the final operator or long wrapped names",async()=>{
 const doc=createOperatorReportPdf({...report,rows:Array.from({length:45},(_,index)=>({...report.rows[index%8],name:index===44?"ÚLTIMO OPERADOR PRESERVADO":"Nome completo de colaborador para teste de quebra de linha "+index}))});const pages=await read(doc);expect(pages.length).toBeGreaterThan(3);expect(pages.join(" ")).toContain("ÚLTIMO OPERADOR PRESERVADO");
});
it("does not export the metrics of modules without access",async()=>{
 const pages=await read(createOperatorReportPdf({...report,available:{whatsapp:false,operations:false,daily:false}}));expect(pages.join(" ")).not.toContain("João Gonçalves");expect(pages.join(" ")).toContain("indisponíveis");
});
