import type {ConfiguredRoutine} from "./routine-filters";
import type {RoutineEdit} from "./edit-model";
export type RoutineClient={id:string;name:string;cluster:string;active?:boolean;team?:string|null};
export type RoutineProcess={id:string;name:string;department?:string;defaultPriority?:string;notifyClient?:boolean};
export type RoutineColumn={id:string;label:string;processName:string;processId?:string;kind:"receipts"|"payments"|"agenda"|"monthlyAudit"|"fortnightAudit"|"customAgenda"|"report"|"process";weekday?:number;notifyClient?:boolean};
const normalized=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
function family(name:string){const n=normalized(name);if(n.includes("concil")&&n.includes("receb"))return "receipts";if(n.includes("concil")&&n.includes("pag"))return "payments";if(n.includes("agenda")&&n.includes("pag"))return "agenda";if(n.includes("auditor"))return "audit";if(n.includes("envio")&&n.includes("relatorio"))return "report";return "process";}
export function routineColumns(input:RoutineProcess[]):RoutineColumn[]{
 const processes=[...new Map(input.map(p=>[p.id,p])).values()];
 const columns:RoutineColumn[]=[
  {id:"receipts",label:"Conciliação de recebimentos",processName:"Conciliação de Recebimentos",kind:"receipts"},
  {id:"payments",label:"Conciliação de pagamentos",processName:"Conciliação de Pagamentos",kind:"payments"},
  ...["Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira"].map((day,i)=>({id:`agenda-${i+1}`,label:`Agenda de pagamentos · ${day}`,processName:"Agenda de Pagamentos",kind:"agenda" as const,weekday:i+1})),
  {id:"monthly-audit",label:"Auditoria mensal",processName:"Auditoria Mensal",kind:"monthlyAudit"},
  {id:"fortnight-audit",label:"Auditoria quinzenal",processName:"Auditoria Quinzenal",kind:"fortnightAudit"},
  {id:"custom-agenda",label:"Agenda personalizada · dias específicos",processName:"Agenda de Pagamentos",kind:"customAgenda"},
  {id:"report",label:"Envio de relatório",processName:"Envio de Relatório",kind:"report"},
 ];
 const standard=processes.filter(p=>p.department!=="Rotinas configuradas");
 for(const column of columns){const process=standard.find(p=>normalized(p.name)===normalized(column.processName))||standard.find(p=>family(p.name)===(column.kind==="customAgenda"?"agenda":column.kind==="monthlyAudit"?"audit":column.kind)&&!normalized(p.name).includes("quinzen"));if(process){column.processId=process.id;column.notifyClient=process.notifyClient;}}
 for(const process of processes.filter(p=>p.department==="Rotinas configuradas"||family(p.name)==="process"))columns.push({id:`process-${process.id}`,label:process.name,processName:process.name,processId:process.id,kind:"process",notifyClient:process.notifyClient});
 return columns;
}
/** A multi-weekday agenda is visible in each covered day without creating copies. */
export function columnsForRoutine(routine:ConfiguredRoutine,columns:RoutineColumn[]):string[]{
 const dedicated=columns.find(c=>c.kind==="process"&&c.processId===routine.processId);if(dedicated)return [dedicated.id];
 const f=family(routine.process.name),data=(routine.recurrenceData||{}) as Record<string,unknown>;
 if(f==="audit"){const fortnight=normalized(routine.process.name).includes("quinzen")||(routine.recurrenceType==="MONTHLY"&&Array.isArray(data.monthDays)&&data.monthDays.length===2)||(routine.recurrenceType==="WEEKLY"&&Number(data.interval)===2);return [fortnight?"fortnight-audit":"monthly-audit"];}
 if(f==="agenda"){
  const days=routine.recurrenceType==="WEEKLY"||routine.recurrenceType==="CUSTOM"?data.weekdays:routine.recurrenceType==="DAILY"&&data.dailyMode==="BUSINESS_DAYS"?[1,2,3,4,5]:routine.recurrenceType==="DAILY"&&data.dailyMode==="CUSTOM_DAYS"?data.weekdays:routine.recurrenceType==="DAILY"?[0,1,2,3,4,5,6]:null;
  if(Array.isArray(days)&&days.length&&!(routine.recurrenceType==="CUSTOM"&&Array.isArray(data.monthDays)&&data.monthDays.length)&&routine.recurrenceType!=="MONTHLY")return [...new Set(days.filter(d=>[1,2,3,4,5].includes(Number(d))).map(d=>`agenda-${Number(d)}`)),...(days.some(d=>[0,6].includes(Number(d)))?["custom-agenda"]:[])];
  return ["custom-agenda"];
 }
 if(f!=="process")return [f];
 return columns.filter(c=>c.kind==="process"&&c.processId===routine.processId).map(c=>c.id);
}
export function routineCellIndex(routines:ConfiguredRoutine[],columns:RoutineColumn[]){const index=new Map<string,ConfiguredRoutine[]>();for(const routine of routines)for(const columnId of columnsForRoutine(routine,columns)){const key=JSON.stringify([routine.clientId,columnId]);index.set(key,[...(index.get(key)||[]),routine]);}return index;}
export const routineCellKey=(clientId:string,columnId:string)=>JSON.stringify([clientId,columnId]);
export function routineColumnNeedsFrequency(column:RoutineColumn){return column.kind==="report"||column.kind==="process"&&!normalized(column.processName).includes("fatura");}
export function routinePreset(column:RoutineColumn,day:string):Pick<RoutineEdit,"recurrenceType"|"recurrenceData">{const fortnight=column.kind==="fortnightAudit"||column.kind==="process"&&normalized(column.processName).includes("fatura"),monthly=["monthlyAudit","customAgenda"].includes(column.kind),weekday=new Date(day+"T12:00Z").getUTCDay();return {recurrenceType:column.kind==="agenda"?"WEEKLY":monthly?"MONTHLY":"DAILY",recurrenceData:{startDate:day,endDate:null,dueTime:"18:00",interval:fortnight?15:1,dailyMode:fortnight?"ALL_DAYS":"BUSINESS_DAYS",weekdays:column.weekday?[column.weekday]:[weekday],monthDays:monthly?[Number(day.slice(-2))]:[],holidayBehavior:"PREVIOUS_BUSINESS_DAY"}};}
