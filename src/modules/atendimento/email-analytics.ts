export type EmailMetric = { id: string | null; name: string; received: number; spam: number; responded: number; resolved: number; open: number };
export type EmailAnalytics = { summary: EmailMetric; clients: EmailMetric[]; operators: EmailMetric[]; from: string; to: string };
type Group = { clientId:string|null; assignedToId:string|null; status:string; isSpam:boolean; _count:{_all:number} };
export function emailMetrics(groups: Group[], answered: Group[], clients: Array<{id:string;name:string}>, users: Array<{id:string;name:string|null;email:string}>) {
 const blank=(id:string|null,name:string):EmailMetric=>({id,name,received:0,spam:0,responded:0,resolved:0,open:0});
 const summary=blank(null,"Total"), byClient=new Map(clients.map(c=>[c.id,blank(c.id,c.name)])),byUser=new Map(users.map(u=>[u.id,blank(u.id,u.name||u.email)]));
 const metric=(map:Map<string,EmailMetric>,id:string|null,label:string)=>{const key=id||"NONE";if(!map.has(key))map.set(key,blank(id,label));return map.get(key)!;};
 for(const group of groups){const count=group._count._all;for(const row of [summary,metric(byClient,group.clientId,"Cliente não identificado"),metric(byUser,group.assignedToId,"Sem responsável")]){row.received+=count;if(group.isSpam||group.status==="SPAM")row.spam+=count;else if(group.status==="RESOLVED")row.resolved+=count;else row.open+=count;}}
 for(const group of answered){const count=group._count._all;summary.responded+=count;metric(byClient,group.clientId,"Cliente não identificado").responded+=count;metric(byUser,group.assignedToId,"Sem responsável").responded+=count;}
 return {summary,clients:[...byClient.values()].filter(r=>r.received).sort((a,b)=>b.received-a.received),operators:[...byUser.values()].filter(r=>r.received).sort((a,b)=>b.received-a.received)};
}
