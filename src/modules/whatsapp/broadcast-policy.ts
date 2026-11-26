import {z} from "zod";
export const BROADCAST_RECIPIENT_LIMIT=1000;
export const BROADCAST_SENDER_NAME="Fortuno | Equipe de Suporte";
export const broadcastRecipientsSchema=z.array(z.object({clientId:z.string().min(1).max(100),ticketId:z.string().min(1).max(100)})).min(1).max(BROADCAST_RECIPIENT_LIMIT).refine(rows=>new Set(rows.map(r=>r.clientId)).size===rows.length&&new Set(rows.map(r=>r.ticketId)).size===rows.length);
export const broadcastScheduleSchema=z.object({id:z.uuid(),name:z.string().trim().min(2).max(100),content:z.string().trim().min(1).max(5000),scheduledAt:z.string().datetime({offset:true}),recipients:broadcastRecipientsSchema}).strict();
export type BroadcastScheduleInput=z.infer<typeof broadcastScheduleSchema>;
export function broadcastScheduleTime(value:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
 const date=new Date(value+":00-03:00");if(!Number.isFinite(+date))return null;
 return new Date(+date-3*3600000).toISOString().slice(0,16)===value?date.toISOString():null;
}
export function validBroadcastTime(value:string,now=new Date()){const time=+new Date(value);return Number.isFinite(time)&&time>=+now+60000&&time<=+now+366*86400000;}
export const broadcastScheduleLabels:Record<string,string>={SCHEDULED:"Agendado",RUNNING:"Em envio",PAUSED:"Pausado · conferir",COMPLETED:"Concluído",PARTIAL:"Concluído com ressalvas",CANCELLED:"Cancelado"};
