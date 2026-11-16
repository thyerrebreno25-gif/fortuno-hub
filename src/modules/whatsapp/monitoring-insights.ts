export const WHATSAPP_SLA={queueMinutes:15,responseMinutes:30,resolutionMinutes:480};
export type LiveMonitoringTicket={id:string;contact:string;clientId:string|null;client:string;assigneeId:string|null;assignee:string;status:string;receivedAt:Date;assignedAt:Date|null;firstResponseAt:Date|null;pendingSince:Date|null;lastMessageAt:Date;lastMessageId:string|null;pendingText:string|null};
const mins=(from:Date,to:Date)=>Math.max(0,Math.floor((+to-+from)/60000));
export function urgencyTerms(text:string){
 const folded=text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/nao\s+(?:e\s+|eh\s+|ha\s+)?(?:urgente|importante)/g,"");
 return [...new Set([...(folded.matchAll(/\b(urgent(?:e|es|issimo|issima|issimos|issimas)|urgencias?|important(?:e|es|issimo|issima|issimos|issimas)|prioridade|imediat[oa]|sem retorno|reclamacao|atrasad[oa]s?)\b/g))].map(row=>row[0]))];
}
export function liveTicketRisk(ticket:LiveMonitoringTicket,now=new Date()){
 const waitingMinutes=ticket.pendingSince?mins(ticket.pendingSince,now):0;
 const queueMinutes=!ticket.assigneeId?mins(ticket.receivedAt,now):0;
 const openMinutes=mins(ticket.receivedAt,now);
 const terms=ticket.pendingSince?urgencyTerms(ticket.pendingText||""):[];
 const reasons=[...(terms.length?["Sinalização do cliente: "+terms.join(", ")]:[]),...(waitingMinutes>=WHATSAPP_SLA.responseMinutes?["Resposta acima de 30 minutos"]:[]),...(queueMinutes>=WHATSAPP_SLA.queueMinutes?["Fila acima de 15 minutos"]:[]),...(openMinutes>=WHATSAPP_SLA.resolutionMinutes&&ticket.status!=="WAITING_CUSTOMER"?["Chamado aberto há mais de 8h"]:[])];
 const severity=terms.length||waitingMinutes>=60||queueMinutes>=30||openMinutes>=960&&ticket.status!=="WAITING_CUSTOMER"?"CRITICAL":reasons.length?"WARNING":"OK";
 return {id:ticket.id,contact:ticket.contact,client:ticket.client,assignee:ticket.assignee,status:ticket.status,waitingMinutes,queueMinutes,terms,reasons,severity,lastMessageAt:new Date(ticket.lastMessageAt).toISOString(),pendingSince:ticket.pendingSince?new Date(ticket.pendingSince).toISOString():null};
}
type Message={direction:string;receivedAt:Date;textBody?:string|null;deliveryStatus?:string|null};
export type InsightTicket={id:string;status:string;routingArea:string;whatsappDepartmentName?:string|null;receivedAt:Date;assignedAt:Date|null;firstResponseAt:Date|null;resolvedAt:Date|null;messages:Message[];client:{id:string;name:string}|null;assignedTo:{id:string;name:string|null;email:string}|null};
const mean=(values:number[])=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):0;
const demandRules=[{name:"Pagamentos e PIX",regex:/\b(pagamento|pagar|pix|boleto|transferencia|ted)\b/},{name:"Cobranças e recebimentos",regex:/\b(cobranca|cobrar|receber|recebimento|inadimplencia)\b/},{name:"Notas fiscais e impostos",regex:/\b(nota fiscal|notas fiscais|nf|nfe|nfse|imposto|tributo)\b/},{name:"Documentos e comprovantes",regex:/\b(documento|documentos|comprovante|comprovantes|extrato|fatura)\b/},{name:"Acessos e sistemas",regex:/\b(acesso|senha|login|sistema|erro|falha|nao funciona)\b/},{name:"Conciliação e fechamento",regex:/\b(conciliacao|conciliar|fechamento|saldo|divergencia)\b/}];
export function monitoringInsights(tickets:InsightTicket[],live:LiveMonitoringTicket[],now=new Date()){
 const weekdays=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"].map((label,day)=>({day,label,conversations:0}));
 const monthDays=Array.from({length:31},(_,index)=>({day:index+1,label:String(index+1),conversations:0}));
 const demands=new Map<string,number>(),bottlenecks=new Map<string,{name:string;conversations:number;queue:number[];resolution:number[];failedMessages:number}>();
 const response:number[]=[],queue:number[]=[],resolution:number[]=[];
 const clientRequests=new Map<string,{id:string;name:string;messages:number;conversations:number;failedMessages:number}>();
 let failedMessages=0,inboundMessages=0,outboundMessages=0;
 const sla={queue:{met:0,breached:0,pending:0},response:{met:0,breached:0,pending:0},resolution:{met:0,breached:0,pending:0}};
 for(const ticket of tickets){
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(ticket.receivedAt);
  weekdays[new Date(date+"T12:00:00Z").getUTCDay()].conversations++;monthDays[Number(date.slice(-2))-1].conversations++;
  const q=ticket.assignedAt?mins(ticket.receivedAt,ticket.assignedAt):null,r=ticket.firstResponseAt?mins(ticket.receivedAt,ticket.firstResponseAt):null,end=ticket.resolvedAt?mins(ticket.receivedAt,ticket.resolvedAt):null;
  if(q!==null)queue.push(q);if(r!==null)response.push(r);if(end!==null)resolution.push(end);
  for(const [key,value,target] of [["queue",q,WHATSAPP_SLA.queueMinutes],["response",r,WHATSAPP_SLA.responseMinutes],["resolution",end,WHATSAPP_SLA.resolutionMinutes]] as const){
   if(value!==null)sla[key][value<=target?"met":"breached"]++;
   else if(!["RESOLVED","SPAM"].includes(ticket.status)&&mins(ticket.receivedAt,now)>target)sla[key].breached++;
   else sla[key].pending++;
  }
  const name=ticket.whatsappDepartmentName||({ACCOUNTS_PAYABLE:"Contas a pagar",ACCOUNTS_RECEIVABLE:"Contas a receber",GENERAL:"Atendimento geral"} as Record<string,string>)[ticket.routingArea]||"Não classificado";
  const point=bottlenecks.get(name)||{name,conversations:0,queue:[],resolution:[],failedMessages:0};point.conversations++;if(q!==null)point.queue.push(q);if(end!==null)point.resolution.push(end);
  const clientKey=ticket.client?.id||"unlinked",clientPoint=clientRequests.get(clientKey)||{id:clientKey,name:ticket.client?.name||"Sem cliente vinculado",messages:0,conversations:0,failedMessages:0};clientPoint.conversations++;
  for(const message of ticket.messages){
   if(message.direction==="OUTBOUND"){outboundMessages++;if(["failed","unconfirmed"].includes(message.deliveryStatus||"")){failedMessages++;point.failedMessages++;clientPoint.failedMessages++;}}
   if(message.direction!=="INBOUND")continue;inboundMessages++;clientPoint.messages++;
   const text=(message.textBody||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
   const matched=demandRules.filter(rule=>rule.regex.test(text));
   for(const name of matched.length?matched.map(rule=>rule.name):["Outras demandas"]){demands.set(name,(demands.get(name)||0)+1);}
  }
  bottlenecks.set(name,point);clientRequests.set(clientKey,clientPoint);
 }
 const risks=live.map(ticket=>liveTicketRisk(ticket,now)).filter(row=>row.waitingMinutes>0||row.reasons.length).sort((a,b)=>Number(b.severity==="CRITICAL")-Number(a.severity==="CRITICAL")||b.waitingMinutes-a.waitingMinutes||b.queueMinutes-a.queueMinutes);
 const liveAgents=new Map<string,{id:string;name:string;active:number;critical:number;waitingMinutes:number}>();
 for(const ticket of live){const id=ticket.assigneeId||"queue",row=liveAgents.get(id)||{id,name:ticket.assignee,active:0,critical:0,waitingMinutes:0};row.active++;const risk=liveTicketRisk(ticket,now);if(risk.severity==="CRITICAL")row.critical++;row.waitingMinutes=Math.max(row.waitingMinutes,risk.waitingMinutes);liveAgents.set(id,row);}
 const percentile=(rows:number[])=>rows.length?[...rows].sort((a,b)=>a-b)[Math.ceil(rows.length*0.95)-1]:null;
 return {liveAgents:[...liveAgents.values()].sort((a,b)=>b.critical-a.critical||b.active-a.active),clientRequests:[...clientRequests.values()].sort((a,b)=>b.messages-a.messages),responseP95Minutes:percentile(response),resolutionP95Minutes:percentile(resolution),resolutionCount:resolution.length,targets:WHATSAPP_SLA,weekdays,monthDays,demands:[...demands].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value),bottlenecks:[...bottlenecks.values()].map(row=>({name:row.name,conversations:row.conversations,averageQueueMinutes:mean(row.queue),averageResolutionMinutes:mean(row.resolution),failedMessages:row.failedMessages})).sort((a,b)=>b.averageResolutionMinutes-a.averageResolutionMinutes),sla,inboundMessages,outboundMessages,failedMessages,averageResolutionMinutes:mean(resolution),currentQueueMinutes:mean(live.filter(row=>!row.assigneeId).map(row=>mins(row.receivedAt,now))),risks,current:{active:live.length,queue:live.filter(row=>!row.assigneeId).length,critical:risks.filter(row=>row.severity==="CRITICAL").length,warning:risks.filter(row=>row.severity==="WARNING").length}};
}
