import { brazilDay } from "@/modules/operations/analytics";
export type OnboardingRow = {
 id:string;status:string;risk:string;expectedEndDate:Date;completedAt:Date|null;companyName:string|null;responsibleName:string|null;
 client:{name:string}|null;responsible:{name:string|null}|null;projectData:unknown;tasks:Array<{status:string}>;
};
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const list=(value:unknown)=>Array.isArray(value)?value:[];
const text=(value:unknown)=>typeof value==="string"?value.trim():"";
const done=(status:unknown)=>status==="COMPLETED"||status==="NOT_APPLICABLE";
export function onboardingSummary(rows:OnboardingRow[],start:Date,end:Date,now:Date){
 const today=brazilDay(now);
 const responsibleMap=new Map<string,{name:string;active:number;pending:number;blocked:number;overdue:number}>();
 const summary={active:0,notStarted:0,inProgress:0,completed:0,completedPeriod:0,overdue:0,atRisk:0,pendingTasks:0,blockedTasks:0,waitingClient:0,
 projects:[] as Array<{id:string;company:string;responsible:string;endDate:string;progress:number;pending:number;blocked:number;waiting:number;risk:"OVERDUE"|"AT_RISK"|"ON_TIME"}>,
 responsibles:[] as Array<{name:string;active:number;pending:number;blocked:number;overdue:number}>};
 for(const row of rows){
  if(row.status==="CANCELLED")continue;
  if(row.status==="COMPLETED"){summary.completed++;if(row.completedAt&&row.completedAt>=start&&row.completedAt<end)summary.completedPeriod++;continue;}
  if(!["OPEN","IN_PROGRESS"].includes(row.status))continue;
  const data=record(row.projectData),stages=Array.isArray(data.stages)?data.stages:null;
  const tasks=stages?stages.flatMap(s=>list(record(s).tasks).map(record)):row.tasks;
  const applicable=tasks.filter(t=>t.status!=="NOT_APPLICABLE");
  const pending=tasks.filter(t=>!done(t.status)).length,blocked=tasks.filter(t=>t.status==="BLOCKED").length,waiting=tasks.filter(t=>t.status==="WAITING_CLIENT").length;
  const progress=stages?Math.round(stages.reduce((sum,s)=>{const stage=record(s),ts=list(stage.tasks).map(record).filter(t=>t.status!=="NOT_APPLICABLE");return sum+(ts.length?Math.round(ts.filter(t=>t.status==="COMPLETED").length/ts.length*100):0)*(typeof stage.weight==="number"?stage.weight:0);},0)/100):applicable.length?Math.round(applicable.filter(t=>t.status==="COMPLETED").length/applicable.length*100):0;
  const endDate=row.expectedEndDate.toISOString().slice(0,10),days=(+new Date(endDate)-+new Date(today))/86400000;
  const overdue=endDate<today,risk=overdue?"OVERDUE":blocked||waiting||row.risk==="AT_RISK"||days<=3?"AT_RISK":"ON_TIME";
  const name=row.responsible?.name?.trim()||row.responsibleName?.trim()||text(data.responsible)||"Sem responsável";
  summary.active++;if(row.status==="OPEN")summary.notStarted++;else summary.inProgress++;
  if(overdue)summary.overdue++;else if(risk==="AT_RISK")summary.atRisk++;
  summary.pendingTasks+=pending;summary.blockedTasks+=blocked;summary.waitingClient+=waiting;
  summary.projects.push({id:row.id,company:row.companyName||row.client?.name||text(data.companyName)||"Implantação sem cliente",responsible:name,endDate,progress:Math.max(0,Math.min(100,progress)),pending,blocked,waiting,risk});
  const key=name.toLocaleLowerCase("pt-BR");const person=responsibleMap.get(key)||{name,active:0,pending:0,blocked:0,overdue:0};person.active++;person.pending+=pending;person.blocked+=blocked;if(overdue)person.overdue++;responsibleMap.set(key,person);
 }
 const priority={OVERDUE:0,AT_RISK:1,ON_TIME:2};
 summary.projects.sort((a,b)=>priority[a.risk]-priority[b.risk]||a.endDate.localeCompare(b.endDate)||a.company.localeCompare(b.company));
 summary.responsibles=[...responsibleMap.values()].sort((a,b)=>b.overdue-a.overdue||b.pending-a.pending||a.name.localeCompare(b.name));
 return summary;
}
