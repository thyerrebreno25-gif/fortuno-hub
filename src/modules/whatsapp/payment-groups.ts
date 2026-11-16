export function groupPaymentRequests<T extends {clientId:string|null;clientName:string|null;ticketId:string;senderName:string|null;status?:string}>(rows:T[]){
 const groups=new Map<string,{id:string;name:string;rows:T[];pending:number}>();
 for(const row of rows){const id=row.clientId||"ticket:"+row.ticketId;const group=groups.get(id)||{id,name:row.clientName||row.senderName||"Conversa sem cliente vinculado",rows:[],pending:0};group.rows.push(row);if(!row.status||row.status==="PENDING")group.pending++;groups.set(id,group);}
 return [...groups.values()].sort((a,b)=>b.pending-a.pending||a.name.localeCompare(b.name,"pt-BR"));
}
