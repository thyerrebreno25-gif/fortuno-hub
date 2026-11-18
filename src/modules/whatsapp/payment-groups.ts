import {canonicalTeam,teamKey} from "@/modules/operations/teams";

export function groupPaymentRequests<T extends {clientId:string|null;clientName:string|null;ticketId:string;senderName:string|null;status?:string}>(rows:T[]){
 const groups=new Map<string,{id:string;name:string;rows:T[];pending:number}>();
 for(const row of rows){const id=row.clientId||"ticket:"+row.ticketId;const group=groups.get(id)||{id,name:row.clientName||row.senderName||"Conversa sem cliente vinculado",rows:[],pending:0};group.rows.push(row);if(!row.status||row.status==="PENDING")group.pending++;groups.set(id,group);}
 return [...groups.values()].sort((a,b)=>b.pending-a.pending||a.name.localeCompare(b.name,"pt-BR"));
}


export function paymentTeamName(row:{clientTeam?:string|null;clientSquad?:string|null}){
 return canonicalTeam(row.clientTeam)||(row.clientSquad==="SQUAD_1"?"Squad 1":row.clientSquad==="SQUAD_2"?"Squad 2":null);
}


/** Use the client's team, regardless of which operator currently owns the ticket. */
export function groupPaymentRequestsByTeam<T extends {clientId:string|null;clientName:string|null;ticketId:string;senderName:string|null;status?:string;clientTeam?:string|null;clientSquad?:string|null}>(rows:T[]){
 const teams=new Map<string,{id:string;name:string;rows:T[];pending:number}>();
 for(const row of rows){
  const name=paymentTeamName(row)||"Equipe não definida",id=teamKey(name);
  const team=teams.get(id)||{id,name,rows:[],pending:0};
  team.rows.push(row);if(!row.status||row.status==="PENDING")team.pending++;
  teams.set(id,team);
 }
 return [...teams.values()].map(team=>({...team,clients:groupPaymentRequests(team.rows)})).sort((a,b)=>b.pending-a.pending||a.name.localeCompare(b.name,"pt-BR"));
}
