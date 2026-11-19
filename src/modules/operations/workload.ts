import {activityDueDay,activityOverdue,activityCompletedLate} from "./activity-deadline";
import {scheduledDay,type AnalyticsActivity,type AnalyticsPeriod,type AnalyticsPerson} from "./analytics";
export type WorkloadPreviewItem={id:string;title:string;client:string;day:string|null};
export type OperatorWorkload={id:string;name:string;total:number;open:number;onTime:number;overdue:number;fineRisk:number;undated:number;blocked:number;completed:number;completedOnTime:number;completedLate:number;completedUndated:number;disregarded:number;completion:number;previews?:Record<string,WorkloadPreviewItem[]>};
export function buildOperatorWorkload(activities:Array<AnalyticsActivity&{subjectToFine?:boolean}>,members:AnalyticsPerson[],period:AnalyticsPeriod,now:Date){
 const create=(id:string,name:string):OperatorWorkload=>({id,name,total:0,open:0,onTime:0,overdue:0,fineRisk:0,undated:0,blocked:0,completed:0,completedOnTime:0,completedLate:0,completedUndated:0,disregarded:0,completion:0});
 const rows=new Map(members.map(m=>[m.id,create(m.id,m.name||m.email)]));
 for(const a of activities){const day=scheduledDay(a);if(day<period.from||day>period.to)continue;const id=a.responsibleId||"UNASSIGNED",r=rows.get(id)||create(id,a.responsible?.name||a.responsible?.email||"Sem responsável");r.total++;
  if(a.status==="DISREGARDED")r.disregarded++;
  else if(a.status==="COMPLETED"){r.completed++;if(!activityDueDay(a)||!a.completedAt)r.completedUndated++;else if(activityCompletedLate(a))r.completedLate++;else r.completedOnTime++;}
  else {r.open++;if(a.status==="BLOCKED")r.blocked++;if(!activityDueDay(a))r.undated++;else if(!activityOverdue(a,now))r.onTime++;else if(a.subjectToFine)r.fineRisk++;else r.overdue++;}
  const bucket=a.status==="DISREGARDED"?"disregarded":a.status==="COMPLETED"?(!activityDueDay(a)||!a.completedAt?"completedUndated":activityCompletedLate(a)?"completedLate":"completedOnTime"):!activityDueDay(a)?"undated":!activityOverdue(a,now)?"onTime":a.subjectToFine?"fineRisk":"overdue";
  r.previews ||= {};
  for(const key of new Set([bucket,...(a.status==="COMPLETED"?["completed"]:a.status!=="DISREGARDED"?["open"]:[]),...(a.status==="BLOCKED"?["blocked"]:[])])){
   const list=r.previews[key] ||= [];if(list.length<50)list.push({id:a.id,title:a.title,client:a.client.name,day:activityDueDay(a)});
  }
  rows.set(id,r);
 }
 for(const r of rows.values())r.completion=r.total-r.disregarded?Math.round(r.completed/(r.total-r.disregarded)*100):0;
 return [...rows.values()].sort((a,b)=>(b.overdue+b.fineRisk)-(a.overdue+a.fineRisk)||b.open-a.open||a.name.localeCompare(b.name,"pt-BR"));
}
