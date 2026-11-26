import {analyticsPeriod,brazilDay,shiftDay} from "@/modules/operations/analytics";
import type {OperatorServiceMetrics,OperatorServiceAttention} from "./operator-service-attention";
export type OperatorDayRow={userId:string;name:string;avatar?:string|null;leader:string|null;messages:number;conversations:number;clients:number;resolved:number;openCalls:number;tasksCompleted:number;tasksPending:number;dailyCompleted:number;dailyPending:number;seconds:number;openTimers:number;scheduled?:number;deliveredScheduled?:number;pendingAtClose?:number;ignoredScheduled?:number;unknownAtClose?:number;blockedAtClose?:number;service?:OperatorServiceMetrics};
export type ReportKind="GENERAL"|"SERVICE";
export type PendingReportWork={id:string;userId:string;title:string;client:string;dueAt:string|null;kind:"TASK"|"DAILY";status:string};
export type ServiceReportSnapshot={open:number;clients:number;queue:number;averageQueueMinutes:number|null;longestQueueMinutes:number|null;averageResolutionMinutes:number|null;resolutionSamples:number;satisfaction:number|null;satisfactionSamples:number;byStatus:Array<{name:string;count:number}>;bySector:Array<{name:string;count:number}>;openClients:Array<{name:string;count:number}>};
export type DayMeeting={title:string;type:string;startsAt:string;status:string;responsible:string;userIds:string[];actions:Array<{title:string;userId:string;dueAt:string;completedAt:string|null}>};
export type DayFeedback={client:string;operator:string;userId:string;score:number;comment:string;answeredAt:string};
export type OperatorDayReport={presentationVersion?:2;kind?:ReportKind;pendingWork?:PendingReportWork[];serviceSnapshot?:ServiceReportSnapshot;feedback?:DayFeedback[];feedbackDay?:string;meetings?:DayMeeting[];day:string;generatedAt:string;scope:string;available:{whatsapp:boolean;operations:boolean;daily:boolean;meetings?:boolean};warnings:string[];rows:OperatorDayRow[];serviceAttention?:OperatorServiceAttention};
export function reportPeriod(day:string|undefined,now=new Date()){
 const selected=day||shiftDay(brazilDay(now),-1),period=analyticsPeriod(selected,selected);
 if(selected>=brazilDay(now))throw new Error("Selecione um dia anterior a hoje.");
 return period;
}
export const reportDuration=(seconds:number)=>`${Math.floor(seconds/3600).toString().padStart(2,"0")}:${Math.floor(seconds%3600/60).toString().padStart(2,"0")}`;
export function reportChatMessages(report:OperatorDayReport,publicUrl?:string){
 const link=publicUrl?"\n\nDashboard executivo · clique para abrir:\n"+publicUrl:"";
 if(report.kind==="SERVICE")return [`Boa tarde, equipe de gestão!\n\nSegue em anexo o panorama de atendimento das 13h: fila, clientes em aberto, tempos de resposta, carga por colaborador e pontos de atenção.${link}\n\nFortuno Hub`];
 const date=report.day.split("-").reverse().join("/");
 return [`Bom dia, equipe de gestão!\n\nSegue em anexo o relatório diário de ${date}, com o resultado da operação, atendimento, feedbacks dos clientes, reuniões e detalhamento por colaborador.${link}\n\nBoa análise!\nFortuno Hub`];
}
