import type {OperatorWorkload} from "@/modules/operations/workload";
export type ExecutiveBriefing={
 workload:OperatorWorkload[];
 time:{seconds:number;entries:number;byUser:Array<{id:string;seconds:number;entries:number}>};
 daily:{open:number;overdue:number;completed:number;byUser:Array<{id:string;open:number;overdue:number;completed:number}>;attention:Array<{id:string;title:string;responsible:string;dueAt:string}>};
 satisfaction:{average:number|null;responses:number;recent:number|null;previous:number|null;delta:number|null;daily:Array<{label:string;value:number}>;byUser:Array<{id:string;average:number;responses:number}>};
 attentionTotal:number;
 attention:Array<{id:string;contact:string;client:string;assignee:string;waitingMinutes:number;severity:string;reasons:string[]}>;
 queue:{count:number;averageMinutes:number;longestMinutes:number};
 sectors:Array<{name:string;open:number;received:number;resolved:number;averageMinutes:number|null}>;
 finance:FinancialBriefing;
 coverage:string[];
};
export type FinancialRow={stage:string;day:string;clientId:string|null;clientName:string|null;userId:string|null;userName:string|null;origin:string;amount:number|string;count:number|string|bigint};
export type FinancialBriefing={importedAmount:number;sentAmount:number;imports:number;confirmed:number;byClient:Array<{id:string;name:string;imports:number;confirmed:number;importedAmount:number;sentAmount:number}>;byUser:Array<{id:string;name:string;imports:number;confirmed:number;importedAmount:number;sentAmount:number}>;daily:Array<{date:string;imports:number;confirmed:number;importedAmount:number;sentAmount:number}>};
/** Import and delivery are separate stages; never sum them as money transacted. */
export function financialBriefing(rows:FinancialRow[]):FinancialBriefing{
 const result:FinancialBriefing={importedAmount:0,sentAmount:0,imports:0,confirmed:0,byClient:[],byUser:[],daily:[]};
 const clients=new Map<string,FinancialBriefing["byClient"][number]>(),people=new Map<string,FinancialBriefing["byUser"][number]>(),days=new Map<string,FinancialBriefing["daily"][number]>();
 for(const row of rows){
  const imported=row.stage==="IMPORT",amount=Math.abs(Number(row.amount)||0),count=Number(row.count)||0;
  const clientKey=row.clientId||"unlinked",userKey=row.userId||"unassigned";
  const client=clients.get(clientKey)||{id:clientKey,name:row.clientName||"Sem cliente vinculado",imports:0,confirmed:0,importedAmount:0,sentAmount:0};
  const person=people.get(userKey)||{id:userKey,name:row.userName||"Sem autoria",imports:0,confirmed:0,importedAmount:0,sentAmount:0};
  const day=days.get(row.day)||{date:row.day,imports:0,confirmed:0,importedAmount:0,sentAmount:0};
  for(const target of [result,client,person,day]){if(imported){target.importedAmount+=amount;target.imports+=count;}else{target.sentAmount+=amount;target.confirmed+=count;}}
  clients.set(clientKey,client);people.set(userKey,person);days.set(row.day,day);
 }
 const rank=(a:{confirmed:number;imports:number;sentAmount:number},b:typeof a)=>b.confirmed-a.confirmed||b.imports-a.imports||b.sentAmount-a.sentAmount;
 result.byClient=[...clients.values()].sort(rank);result.byUser=[...people.values()].sort(rank);result.daily=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date));return result;
}
export function satisfactionBriefing(rows:Array<{operatorId:string;day:string;total:number|string;count:number|string|bigint}>,from:string,to:string,now=new Date()):ExecutiveBriefing["satisfaction"]{
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 const shift=(days:number)=>new Date(Date.parse(today+"T12:00:00Z")+days*86400000).toISOString().slice(0,10);
 const people=new Map<string,{id:string;total:number;responses:number}>();let total=0,count=0,recentTotal=0,recentCount=0,previousTotal=0,previousCount=0;
 const daily=new Map<string,{total:number;count:number}>();
 for(const row of rows){const c=Number(row.count),t=Number(row.total);if(row.day>=from&&row.day<=to){total+=t;count+=c;const person=people.get(row.operatorId)||{id:row.operatorId,total:0,responses:0};person.total+=t;person.responses+=c;people.set(row.operatorId,person);}
  if(row.day>=shift(-6)&&row.day<=today){recentTotal+=t;recentCount+=c;}else if(row.day>=shift(-13)&&row.day<shift(-6)){previousTotal+=t;previousCount+=c;}
  if(row.day>=shift(-13)&&row.day<=today){const point=daily.get(row.day)||{total:0,count:0};point.total+=t;point.count+=c;daily.set(row.day,point);}
 }
 const average=(value:number,sample:number)=>sample?Math.round(value/sample*100)/100:null;
 const recent=average(recentTotal,recentCount),previous=average(previousTotal,previousCount);
 return {average:average(total,count),responses:count,recent,previous,delta:recent!==null&&previous!==null?Math.round((recent-previous)*100)/100:null,daily:[...daily].sort(([a],[b])=>a.localeCompare(b)).map(([label,point])=>({label:label.slice(8)+"/"+label.slice(5,7),value:point.total/point.count})),byUser:[...people.values()].filter(p=>p.responses).map(p=>({id:p.id,average:p.total/p.responses,responses:p.responses}))};
}
