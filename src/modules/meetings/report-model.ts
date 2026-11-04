import {createHash} from "node:crypto";
import {z} from "zod";
export const reportSummarySchema=z.object({summary:z.string().max(12000),topics:z.array(z.object({title:z.string().max(300),points:z.array(z.string().max(2500)).max(30)})).max(40),decisions:z.array(z.string().max(2500)).max(50),pending:z.array(z.string().max(2500)).max(50),nextSteps:z.array(z.string().max(2500)).max(50)});
export type ReportSummary=z.infer<typeof reportSummarySchema>;
type Person={name:string|null;email:string};
export type ReportMeeting={id:string;title:string;type:string;startsAt:Date|string;endsAt:Date|string;agenda:string;notes:string;status:string;participants:Array<{userId:string;user:Person}>;actions:Array<{id:string;title:string;description:string;dueAt:Date|string;completedAt:Date|string|null;responsible:Person}>;contributions:Array<{id:string;body:string;createdAt:Date|string;author:Person}>;recordings:Array<{id:string;name:string;status:string;transcript:string}>};
const iso=(value:Date|string)=>new Date(value).toISOString();
const person=(value:Person)=>value.name||value.email;
const date=(value:Date|string)=>new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
export function reportSource(meeting:ReportMeeting,includeRecordings:boolean){
 return {title:meeting.title,type:meeting.type,startsAt:iso(meeting.startsAt),endsAt:iso(meeting.endsAt),agenda:meeting.agenda,notes:meeting.notes,
 participants:meeting.participants.map(row=>({id:row.userId,name:person(row.user)})).sort((a,b)=>a.id.localeCompare(b.id)),
 actions:meeting.actions.map(row=>({id:row.id,title:row.title,description:row.description,responsible:person(row.responsible),dueAt:iso(row.dueAt),completedAt:row.completedAt?iso(row.completedAt):null})).sort((a,b)=>a.id.localeCompare(b.id)),
 contributions:meeting.contributions.map(row=>({id:row.id,author:person(row.author),createdAt:iso(row.createdAt),body:row.body})).sort((a,b)=>a.id.localeCompare(b.id)),
 recordings:meeting.recordings.map(row=>({id:row.id,name:row.name,...(includeRecordings?{status:row.status,transcript:row.transcript}:{included:false})})).sort((a,b)=>a.id.localeCompare(b.id)),includeRecordings};
}
export function reportFingerprint(meeting:ReportMeeting,includeRecordings:boolean){return createHash("sha256").update(JSON.stringify(reportSource(meeting,includeRecordings))).digest("hex");}
export function splitReportText(text:string,limit=20000){
 const chunks:string[]=[];let offset=0;
 while(offset<text.length){let end=Math.min(text.length,offset+limit);if(end<text.length){const boundary=Math.max(text.lastIndexOf("\n",end),text.lastIndexOf(" ",end));if(boundary>offset+limit/2)end=boundary+1;}chunks.push(text.slice(offset,end));offset=end;}
 return chunks;
}
export function renderMeetingReport(meeting:ReportMeeting,summary:ReportSummary|null,includeRecordings:boolean){
 const lines=["# Relatório da reunião",meeting.title,"Tipo: "+meeting.type,"Horário agendado: "+date(meeting.startsAt)+" até "+date(meeting.endsAt)+" (Brasília)","Participantes cadastrados: "+meeting.participants.map(row=>person(row.user)).join(", "),""];
 if(summary){lines.push("## Resumo executivo",summary.summary,"");for(const topic of summary.topics)lines.push("### "+topic.title,...topic.points.map(point=>"• "+point),"");for(const [title,items]of [["Decisões registradas",summary.decisions],["Pendências e pontos de atenção",summary.pending],["Próximos passos",summary.nextSteps]] as const)lines.push("## "+title,...(items.length?items.map(item=>"• "+item):["Nenhum registro identificado nas fontes."]),"");}
 else lines.push("## Consolidação dos registros","Relatório estruturado a partir dos dados do Hub. A síntese por IA não foi utilizada.","");
 lines.push("## Atividades distribuídas");
 if(!meeting.actions.length)lines.push("Nenhuma atividade distribuída.");
 for(const action of meeting.actions)lines.push("### "+action.title,"Responsável: "+person(action.responsible),"Prazo: "+date(action.dueAt)+" (Brasília)","Situação: "+(action.completedAt?"Concluída em "+date(action.completedAt):"Pendente"),...(action.description?["Detalhes: "+action.description]:[]),"");
 lines.push("## Pauta registrada",meeting.agenda||"Nenhuma pauta registrada.","","## Notas gerais",meeting.notes||"Nenhuma nota geral registrada.","","## Anotações da equipe");
 if(!meeting.contributions.length)lines.push("Nenhuma anotação registrada.");
 for(const note of meeting.contributions)lines.push("### "+person(note.author)+" · "+date(note.createdAt),note.body,"");
 lines.push("## Gravações e transcrição");
 if(!meeting.recordings.length)lines.push("Nenhuma gravação anexada.");
 else if(!includeRecordings)lines.push("As gravações não foram incluídas nesta versão do relatório.");
 else lines.push(...meeting.recordings.map(row=>"• "+row.name+" — "+(row.status==="DONE"?"transcrição utilizada na síntese":row.status==="UPLOADING"?"envio pendente, não incluído nesta versão":"transcrição não disponível")),"O texto integral permanece na aba Gravações e transcrições. A síntese acima organiza as falas por assunto; não atribui interlocutores sem identificação na fonte.");
 return lines.join("\n");
}
