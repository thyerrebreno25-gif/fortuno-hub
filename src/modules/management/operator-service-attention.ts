import {WHATSAPP_SLA} from "@/modules/whatsapp/monitoring-insights";
export type OperatorServiceMetrics={openCalls:number;responseSamples:number;averageResponseMinutes:number|null;longestResponseMinutes:number|null;responseBreaches:number;waitingCalls:number;overdueResponses:number;longestWaitMinutes:number|null;longOpenCalls:number;averageOpenMinutes:number|null;longestOpenMinutes:number|null;closureReviewCalls:number;waitingCustomerCalls:number;alerts:string[]};
export type ServiceAttentionCase={ticketId:string;userId:string;operator:string;client:string;contact:string;status:string;openMinutes:number;waitingMinutes:number|null;reasons:string[];severity:"CRITICAL"|"WARNING"};
export type OperatorServiceAttention={measuredAt:string;responseTargetMinutes:number;openTargetMinutes:number;totalCases:number;cases:ServiceAttentionCase[];truncated:boolean};
export type ServiceOpenRow={id:string;userId:string;contact:string;client:string;status:string;openedAt:Date|string;lastOutboundAt:Date|string|null;pendingSince:Date|string|null};
export type ServiceResponseRow={userId:string;minutes:number};
const empty=():OperatorServiceMetrics=>({openCalls:0,responseSamples:0,averageResponseMinutes:null,longestResponseMinutes:null,responseBreaches:0,waitingCalls:0,overdueResponses:0,longestWaitMinutes:null,longOpenCalls:0,averageOpenMinutes:null,longestOpenMinutes:null,closureReviewCalls:0,waitingCustomerCalls:0,alerts:[]});
export function serviceMinutes(value:number|null|undefined){if(value==null||!Number.isFinite(value))return "-";const minutes=Math.max(0,Math.floor(value));return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,"0")}min`;}
const elapsed=(date:Date|string,now:Date)=>Math.max(0,Math.floor((+now-+new Date(date))/60000));
const quantity=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;
export function summarizeOperatorService(operators:Array<{userId:string;name:string;messages:number;resolved:number}>,openRows:ServiceOpenRow[],responses:ServiceResponseRow[],now:Date,floor:Date|null=null,truncated=false){
 const metrics=new Map(operators.map(row=>[row.userId,empty()])),people=new Map(operators.map(row=>[row.userId,row]));
 const responseTotals=new Map<string,number>(),openTotals=new Map<string,{minutes:number;count:number}>(),cases:ServiceAttentionCase[]=[];
 for(const response of responses){const row=metrics.get(response.userId);if(!row||!Number.isFinite(response.minutes)||response.minutes<0)continue;row.responseSamples++;responseTotals.set(response.userId,(responseTotals.get(response.userId)||0)+response.minutes);row.longestResponseMinutes=Math.max(row.longestResponseMinutes||0,response.minutes);if(response.minutes>=WHATSAPP_SLA.responseMinutes)row.responseBreaches++;}
 const measured=(value:Date|string)=>{const date=new Date(value);return floor&&floor>date?floor:date;};
 for(const ticket of openRows){const row=metrics.get(ticket.userId),person=people.get(ticket.userId);if(!row||!person||!Number.isFinite(+new Date(ticket.openedAt))||+new Date(ticket.openedAt)>+now)continue;
  const openMinutes=elapsed(measured(ticket.openedAt),now),pending=ticket.pendingSince&&Number.isFinite(+new Date(ticket.pendingSince))&&+new Date(ticket.pendingSince)<=+now?measured(ticket.pendingSince):null,waitingMinutes=pending?elapsed(pending,now):null;
  const totals=openTotals.get(ticket.userId)||{minutes:0,count:0};totals.minutes+=openMinutes;totals.count++;row.openCalls++;openTotals.set(ticket.userId,totals);row.longestOpenMinutes=Math.max(row.longestOpenMinutes||0,openMinutes);
  const waitingCustomer=ticket.status==="WAITING_CUSTOMER"&&!pending;
  if(waitingCustomer)row.waitingCustomerCalls++;
  if(pending){row.waitingCalls++;row.longestWaitMinutes=Math.max(row.longestWaitMinutes||0,waitingMinutes!);if(waitingMinutes!>=WHATSAPP_SLA.responseMinutes)row.overdueResponses++;}
  const longOpen=!waitingCustomer&&openMinutes>=WHATSAPP_SLA.resolutionMinutes;if(longOpen)row.longOpenCalls++;
  const closureReview=ticket.status==="IN_PROGRESS"&&!pending&&Boolean(ticket.lastOutboundAt)&&Number.isFinite(+new Date(ticket.lastOutboundAt!))&&+new Date(ticket.lastOutboundAt!)<=+now&&longOpen&&elapsed(measured(ticket.lastOutboundAt!),now)>=WHATSAPP_SLA.responseMinutes;
  if(closureReview)row.closureReviewCalls++;
  const reasons=[...(waitingMinutes!==null&&waitingMinutes>=WHATSAPP_SLA.responseMinutes?[`Cliente sem resposta há ${serviceMinutes(waitingMinutes)}`]:[]),...(longOpen?[`Aberto há ${serviceMinutes(openMinutes)}`]:[]),...(closureReview?["Respondido e ainda aberto: revisar finalização"]:[])];
  if(reasons.length)cases.push({ticketId:ticket.id,userId:ticket.userId,operator:person.name,client:ticket.client,contact:ticket.contact,status:ticket.status,openMinutes,waitingMinutes,reasons,severity:(waitingMinutes!==null&&waitingMinutes>=60||!waitingCustomer&&openMinutes>=960)?"CRITICAL":"WARNING"});
 }
 for(const [id,row] of metrics){const person=people.get(id)!;if(row.responseSamples){row.averageResponseMinutes=Math.round(responseTotals.get(id)!/row.responseSamples);row.longestResponseMinutes=Math.round(row.longestResponseMinutes!);}const opened=openTotals.get(id);if(opened)row.averageOpenMinutes=Math.round(opened.minutes/opened.count);
  if(row.overdueResponses)row.alerts.push(`${quantity(row.overdueResponses,"conversa com cliente aguardando","conversas com clientes aguardando")} resposta há 30 min ou mais; maior espera: ${serviceMinutes(row.longestWaitMinutes)}.`);
  if(row.longOpenCalls)row.alerts.push(`${quantity(row.longOpenCalls,"chamado aberto","chamados abertos")} há 8h ou mais, fora dos casos aguardando o cliente.`);
  if(row.closureReviewCalls)row.alerts.push(`${quantity(row.closureReviewCalls,"conversa já respondida permanece aberta","conversas já respondidas permanecem abertas")} há 8h ou mais, sem mensagem pendente do cliente: revisar necessidade de finalização.`);
  if(person.messages>0&&person.resolved===0&&row.closureReviewCalls>0)row.alerts.push("Sem finalizações registradas no dia, apesar das mensagens enviadas e das conversas sinalizadas para revisão de encerramento.");
  if(row.responseBreaches)row.alerts.push(`Resposta média de ${serviceMinutes(row.averageResponseMinutes)} em ${quantity(row.responseSamples,"rodada respondida","rodadas respondidas")} no dia; ${row.responseBreaches} ${row.responseBreaches===1?"levou":"levaram"} 30 min ou mais.`);
 }
 cases.sort((a,b)=>Number(b.severity==="CRITICAL")-Number(a.severity==="CRITICAL")||(b.waitingMinutes||0)-(a.waitingMinutes||0)||b.openMinutes-a.openMinutes||a.ticketId.localeCompare(b.ticketId));
 return {metrics,attention:{measuredAt:now.toISOString(),responseTargetMinutes:WHATSAPP_SLA.responseMinutes,openTargetMinutes:WHATSAPP_SLA.resolutionMinutes,totalCases:cases.length,cases:cases.slice(0,20),truncated} satisfies OperatorServiceAttention};
}
