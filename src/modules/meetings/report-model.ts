import {groupMeetingAssignments} from "./meeting-text";
import {createHash} from "node:crypto";
import {z} from "zod";
export const reportSummarySchema=z.object({summary:z.string().max(12000),topics:z.array(z.object({title:z.string().max(300),points:z.array(z.string().max(2500)).max(30)})).max(40),decisions:z.array(z.string().max(2500)).max(50),pending:z.array(z.string().max(2500)).max(50),nextSteps:z.array(z.string().max(2500)).max(50)});
export type ReportSummary=z.infer<typeof reportSummarySchema>;
type Person={name:string|null;email:string};
export type ReportAction={id:string;title:string;description:string;dueAt:Date|string;completedAt:Date|string|null;responsible:Person;originalDueAt?:Date|string|null;autoExtendedAt?:Date|string|null;origin?:{id:string;title:string;startsAt:Date|string}};
export type ReportMeeting={referenceAt?:Date|string;carryoverActions?:ReportAction[];fathomEnabled?:boolean;fathomRecordings?:Array<{id:string;title:string;transcript:string;summary:string;actionItems:string}>;id:string;title:string;type:string;startsAt:Date|string;endsAt:Date|string;agenda:string;notes:string;status:string;participants:Array<{userId:string;user:Person}>;actions:ReportAction[];contributions:Array<{id:string;body:string;createdAt:Date|string;author:Person}>;recordings:Array<{id:string;name:string;status:string;transcript:string}>};
const iso=(value:Date|string)=>new Date(value).toISOString();
const person=(value:Person)=>value.name||value.email;
const date=(value:Date|string)=>new Date(value).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"});
export function reportCarryovers(meeting:ReportMeeting){
 const own=new Set(meeting.actions.map(action=>action.id));
 return [...new Map((meeting.carryoverActions||[]).filter(action=>!own.has(action.id)).map(action=>[action.id,action])).values()];
}
export function reportSource(meeting:ReportMeeting,includeRecordings:boolean){
 return {fathomEnabled:includeRecordings&&Boolean(meeting.fathomEnabled),fathom:includeRecordings&&meeting.fathomEnabled?(meeting.fathomRecordings||[]).map(row=>({id:row.id,title:row.title,transcript:row.transcript,summary:row.summary,actionItems:row.actionItems})).sort((a,b)=>a.id.localeCompare(b.id)):[],title:meeting.title,type:meeting.type,startsAt:iso(meeting.startsAt),endsAt:iso(meeting.endsAt),agenda:meeting.agenda,notes:meeting.notes,
 ...(reportCarryovers(meeting).length?{reportLayout:"daily-assignments-v2",carryoverActions:reportCarryovers(meeting).map(row=>({id:row.id,title:row.title,description:row.description,responsible:person(row.responsible),dueAt:iso(row.dueAt),originalDueAt:row.originalDueAt?iso(row.originalDueAt):null,autoExtendedAt:row.autoExtendedAt?iso(row.autoExtendedAt):null,completedAt:row.completedAt?iso(row.completedAt):null,origin:row.origin?{id:row.origin.id,title:row.origin.title,startsAt:iso(row.origin.startsAt)}:null})).sort((a,b)=>a.id.localeCompare(b.id))}:{}),
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
 const carried=reportCarryovers(meeting),reference=meeting.referenceAt?new Date(meeting.referenceAt):new Date();
 const late=(action:ReportAction)=>!action.completedAt&&+new Date(action.dueAt)<+reference;
 const actions=[...meeting.actions,...carried].sort((a,b)=>person(a.responsible).localeCompare(person(b.responsible),"pt-BR")||Number(Boolean(a.completedAt))-Number(Boolean(b.completedAt))||Number(late(b))-Number(late(a))||+new Date(a.dueAt)-+new Date(b.dueAt)||a.id.localeCompare(b.id));
 if(summary){lines.push("## Resumo executivo",summary.summary,"");for(const topic of summary.topics)lines.push("### "+topic.title,...topic.points.map(point=>"• "+point),"");for(const [title,items]of [["Decisões registradas",summary.decisions],["Pendências e pontos de atenção",summary.pending],["Próximos passos",summary.nextSteps]] as const)lines.push("## "+title,...(items.length?items.map(item=>"• "+item):["Nenhum registro identificado nas fontes."]),"");}
 else lines.push("## Consolidação dos registros","Relatório estruturado a partir dos dados do Hub. A síntese por IA não foi utilizada.","");
 lines.push("## Atividades distribuídas");
 if(!actions.length)lines.push("Nenhuma atividade distribuída.");
 else lines.push(`${actions.length} atividade(s) · ${actions.filter(action=>!action.completedAt).length} pendente(s) · ${actions.filter(late).length} em atraso · ${actions.filter(action=>action.completedAt).length} concluída(s)`,"");
 for(const action of actions){
  const minutes=Math.max(0,Math.floor((+reference-+new Date(action.dueAt))/60000)),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
  const wait=[days?days+" dia(s)":"",hours?hours+"h":"",minutes%60?minutes%60+"min":""].filter(Boolean).join(" ")||"menos de 1 min";
  const state=action.completedAt?"Concluída em "+date(action.completedAt):late(action)?"EM ATRASO há "+wait:"Pendente";
  lines.push("### "+action.title,"Responsável: "+person(action.responsible),"Prazo: "+date(action.dueAt)+" (Brasília)","Situação: "+state,...(action.description?["Detalhes: "+action.description]:[]),"");
 }
 lines.push("## Pauta registrada",meeting.agenda||"Nenhuma pauta registrada.","","## Notas gerais",meeting.notes||"Nenhuma nota geral registrada.","","## Anotações da equipe");
 if(!meeting.contributions.length)lines.push("Nenhuma anotação registrada.");
 for(const note of meeting.contributions)lines.push("### "+person(note.author)+" · "+date(note.createdAt),note.body,"");
 lines.push("## Gravações e transcrição");
 if(!meeting.recordings.length)lines.push("Nenhuma gravação anexada.");
 else if(!includeRecordings)lines.push("As gravações não foram incluídas nesta versão do relatório.");
 else lines.push(...meeting.recordings.map(row=>"• "+row.name+" — "+(row.status==="DONE"?"transcrição utilizada na síntese":row.status==="UPLOADING"?"envio pendente, não incluído nesta versão":"transcrição não disponível")),"O texto integral permanece na aba Gravações e transcrições. A síntese acima organiza as falas por assunto; não atribui interlocutores sem identificação na fonte.");
 return groupMeetingAssignments(lines.join("\n"));
}
