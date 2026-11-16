export type WhatsAppUsageRow={userId:string;name:string;messages:number;comments:number;actions:number;conversations:number;clients:number;activeDays:number;lastAt:string|null;share:number};
export function whatsappUsagePeriod(from:string|null,to:string|null,now=new Date()){
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 const first=from||today.slice(0,7)+"-01",last=to||today;
 const valid=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+"T00:00:00Z"))&&new Date(day+"T00:00:00Z").toISOString().slice(0,10)===day;
 if(!valid(first)||!valid(last)||first>last)throw new Error("Confira as datas do período.");
 const start=new Date(first+"T00:00:00-03:00"),end=new Date(new Date(last+"T00:00:00-03:00").getTime()+86400000);
 if(+end-+start>366*86400000)throw new Error("Selecione um período de até 366 dias.");
 return {from:first,to:last,start,end};
}
export function whatsappUsageReport(rows:Omit<WhatsAppUsageRow,"share">[]){
 const messages=rows.reduce((sum,row)=>sum+row.messages,0),actions=rows.reduce((sum,row)=>sum+row.actions,0);
 return {summary:{messages,actions,activeUsers:rows.filter(row=>row.actions>0).length,totalUsers:rows.length},rows:rows.map(row=>({...row,share:messages?Math.round(row.messages/messages*1000)/10:0})).sort((a,b)=>b.messages-a.messages||b.actions-a.actions||a.name.localeCompare(b.name,"pt-BR"))};
}
