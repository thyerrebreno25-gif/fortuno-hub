import {jsPDF} from "jspdf";
type Report={content:string;generatedAt:string|null;status:string;outdated?:boolean};
const clean=(text:string)=>text.normalize("NFC").replace(/[\u2010-\u2015\u2212]/g,"-").replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,"...").replace(/[•●]/g,"-").replace(/\u00a0/g," ").replace(/\p{Extended_Pictographic}/gu,"").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,"");
export function createMeetingReportPdf(report:Report){
 const doc=new jsPDF({unit:"mm",format:"a4"});const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=17,available=width-2*margin;
 let y=30;const header=()=>{doc.setFillColor(13,35,64);doc.rect(0,0,width,19,"F");doc.setTextColor(255);doc.setFont("helvetica","bold");doc.setFontSize(12);doc.text("Fortuno Hub | Relatório de reunião",margin,12);};
 const next=()=>{doc.addPage();header();y=30;};
 const reserve=(space:number)=>{if(y+space>height-20)next();};
 function write(text:string,size:number,bold=false,space=2){
  doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(22,39,59);
  const lines=doc.splitTextToSize(clean(text),available) as string[];const lineHeight=size*0.3528*1.4;
  for(const line of lines){reserve(lineHeight);doc.setFont("helvetica",bold?"bold":"normal");doc.setFontSize(size);doc.setTextColor(22,39,59);doc.text(line,margin,y);y+=lineHeight;}y+=space;
 }
 header();
 if(report.generatedAt)write("Gerado em "+new Date(report.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})+" (Brasília)",8,false,4);
 if(report.status!=="READY")write("Versão parcial: processamento ou atualização ainda em andamento.",9,true,4);
 if(report.outdated)write("Os registros foram alterados após esta versão. Gere novamente para atualizar o relatório.",9,true,4);
 const lines=report.content.split(/\r?\n/);
 for(let index=0;index<lines.length;index++){
  const line=lines[index];if(!line.trim()){y+=2;continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){const size=heading[1].length===1?16:heading[1].length===2?12:10;doc.setFontSize(size);doc.setFont("helvetica","bold");const count=(doc.splitTextToSize(clean(heading[2]),available) as string[]).length;reserve(Math.min(count*size*.3528*1.4+12,height-55));y+=2;write(heading[2],size,true,3);}
  else write(line.replace(/\*\*([^*]+)\*\*/g,"$1"),9.5,false,1.4);
 }
 const pages=doc.getNumberOfPages();for(let page=1;page<=pages;page++){doc.setPage(page);doc.setDrawColor(218,226,235);doc.line(margin,height-15,width-margin,height-15);doc.setTextColor(98,112,132);doc.setFont("helvetica","normal");doc.setFontSize(8);doc.text("Fortuno Hub - registro da reunião",margin,height-10);doc.text("Página "+page+" de "+pages,width-margin,height-10,{align:"right"});}
 return doc;
}
