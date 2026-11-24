import {analyticsPeriod,brazilDay,shiftDay} from "@/modules/operations/analytics";
export type OperatorDayRow={userId:string;name:string;leader:string|null;messages:number;conversations:number;clients:number;resolved:number;openCalls:number;tasksCompleted:number;tasksPending:number;dailyCompleted:number;dailyPending:number;seconds:number;openTimers:number};
export type OperatorDayReport={day:string;generatedAt:string;scope:string;available:{whatsapp:boolean;operations:boolean;daily:boolean};warnings:string[];rows:OperatorDayRow[]};
export function reportPeriod(day:string|undefined,now=new Date()){
 const selected=day||shiftDay(brazilDay(now),-1),period=analyticsPeriod(selected,selected);
 if(selected>=brazilDay(now))throw new Error("Selecione um dia anterior a hoje.");
 return period;
}
export const reportDuration=(seconds:number)=>`${Math.floor(seconds/3600).toString().padStart(2,"0")}:${Math.floor(seconds%3600/60).toString().padStart(2,"0")}`;
const safe=(value:string)=>value.replace(/[<>*_`~\r\n]/g," ").replace(/\s+/g," ").trim().slice(0,180);
export function reportChatMessages(report:OperatorDayReport){
 const date=report.day.split("-").reverse().join("/"),head=`*FORTUNO | Relatório diário*\n*${date}* · ${safe(report.scope)}\n${report.rows.length} operador(es)\n`;
 const blocks=report.rows.map(row=>`*${safe(row.name)}*${row.leader?` · Gestão: ${safe(row.leader)}`:""}\n`+[
  report.available.whatsapp?`WhatsApp: ${row.messages} mensagens enviadas · ${row.conversations} conversas movimentadas · ${row.clients} clientes · ${row.resolved} finalizações`:null,
  report.available.operations?`Tarefas: ${row.tasksCompleted} conclusões · Tempo confirmado: ${reportDuration(row.seconds)} h`:null,
  report.available.daily?`Daily: ${row.dailyCompleted} entregas`:null,
  `Pendências na geração: ${[report.available.whatsapp?`${row.openCalls} chamados abertos`:null,report.available.operations?`${row.tasksPending} tarefas`:null,report.available.daily?`${row.dailyPending} atividades Daily`:null].filter(Boolean).join(" · ")}`,
  report.available.operations&&row.openTimers?`⚠ ${row.openTimers} cronômetro(s) aberto(s), fora do tempo confirmado`:null,
 ].filter(Boolean).join("\n"));
 const footer=`\n_Produção referente ao dia indicado, no horário de Brasília. Pendências refletem a situação na geração; incluem prazos até esse dia. Tempo confirmado considera apenas apontamentos encerrados._\nGerado: ${new Date(report.generatedAt).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}${report.warnings.length?"\n"+report.warnings.map(safe).join("\n"):""}`;
 const parts:string[]=[];let current=head;
 for(const block of blocks){if(new TextEncoder().encode(current+"\n"+block+footer).length>28000){parts.push(current);current=head+"(continuação)\n";}current+="\n"+block+"\n";}
 parts.push(current+footer);return parts;
}
export function googleChatWebhook(value:string){
 let url:URL;try{url=new URL(value);}catch{throw new Error("Informe um webhook válido do Google Chat.");}
 const keys=[...url.searchParams.keys()];
 if(url.protocol!=="https:"||url.hostname!=="chat.googleapis.com"||url.port||url.username||url.password||url.hash||!/^\/v1\/spaces\/[A-Za-z0-9_-]+\/messages$/.test(url.pathname)||!url.searchParams.get("key")||!url.searchParams.get("token")||keys.some(key=>!["key","token"].includes(key))||keys.length!==2)throw new Error("Use o webhook de um espaço do Google Chat, com key e token.");
 return url.toString();
}
