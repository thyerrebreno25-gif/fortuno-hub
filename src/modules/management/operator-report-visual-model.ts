import type {OperatorDayReport,OperatorDayRow,ReportKind} from "./operator-report-model";
export const reportViewPath=(day:string,kind:ReportKind="GENERAL")=>`/gestao/relatorio-diario?day=${encodeURIComponent(day)}&kind=${kind}`;
export function filterOperatorReport(report:OperatorDayReport,userId:string|null):OperatorDayReport{
 const row=report.rows.find(item=>item.userId===userId);if(!row)return report;
 const cases=report.serviceAttention?.cases.filter(item=>item.userId===userId)||[];
 return {...report,scope:row.name,rows:[row],pendingWork:report.pendingWork?.filter(item=>item.userId===userId),serviceSnapshot:undefined,
  serviceAttention:report.serviceAttention?{...report.serviceAttention,cases,totalCases:cases.length}:undefined};
}
export function operatorVisualMetrics(report:OperatorDayReport){
 const sum=(key:keyof OperatorDayRow)=>report.rows.reduce((total,row)=>total+(typeof row[key]==="number"?row[key] as number:0),0);
 const metrics=report.rows.flatMap(row=>row.service?[row.service]:[]),samples=metrics.reduce((n,row)=>n+row.responseSamples,0);
 return {messages:sum("messages"),tasks:sum("tasksCompleted"),daily:sum("dailyCompleted"),seconds:sum("seconds"),pendingTasks:sum("tasksPending"),pendingDaily:sum("dailyPending"),timers:sum("openTimers"),
  open:report.serviceSnapshot?.open??sum("openCalls"),overdue:metrics.reduce((n,row)=>n+row.overdueResponses,0),longOpen:metrics.reduce((n,row)=>n+row.longOpenCalls,0),
  responseSamples:samples,response:samples?metrics.reduce((n,row)=>n+(row.averageResponseMinutes??0)*row.responseSamples,0)/samples:null};
}
