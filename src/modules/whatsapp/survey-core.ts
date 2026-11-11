import { z } from "zod";
export const DEFAULT_SURVEY_MESSAGE="Olá! Queremos ouvir sua opinião sobre o atendimento da nossa equipe. Avalie de 1 a 5 e, se quiser, deixe um comentário: {{link}}\nSua participação é opcional. Obrigado!";
export const surveyPolicySchema=z.object({enabled:z.boolean(),cadenceDays:z.number().int().min(7).max(90),delayMinutes:z.number().int().min(15).max(240),message:z.string().trim().min(20).max(1000).refine(s=>(s.match(/\{\{link\}\}/g)||[]).length===1,"Inclua {{link}} uma única vez.")});
export const surveyAnswerSchema=z.object({respondentName:z.string().trim().max(120).default(""),score:z.number().int().min(1).max(5).optional(),comment:z.string().trim().max(1000).default(""),decline:z.boolean().default(false),optOut:z.boolean().default(false)}).refine(v=>v.decline || v.score!==undefined&&v.respondentName.length>=2,"Informe seu nome e uma nota de 1 a 5.");
// Send once near the end of a business day (16:45–17:00 Brasília).
export function nextSurveyBusinessTime(date:Date) {
 const local=new Date(date.getTime()-3*3600000),minutes=local.getUTCHours()*60+local.getUTCMinutes();
 if(![0,6].includes(local.getUTCDay())&&minutes>=16*60+45&&minutes<17*60)return new Date(date);
 if([0,6].includes(local.getUTCDay())||minutes>=17*60)local.setUTCDate(local.getUTCDate()+1);
 local.setUTCHours(16,45,0,0);while([0,6].includes(local.getUTCDay()))local.setUTCDate(local.getUTCDate()+1);
 return new Date(local.getTime()+3*3600000);
}

export function isSurveyCoolingDown(previous:{status:string;sentAt:Date|null;createdAt:Date}|null,cadenceDays:number,now:Date) {
  if(!previous)return false;
  if(["PENDING","SENDING"].includes(previous.status))return true;
  return (previous.sentAt||previous.createdAt).getTime()>now.getTime()-cadenceDays*86400000;
}
export function surveySummary(rows:Array<{status:string;score:number|null;sentAt:Date|string|null}>) {
  const sent=rows.filter(r=>r.sentAt&&["SENT","ANSWERED","DECLINED","EXPIRED"].includes(r.status)).length;
  const scores=rows.filter(r=>r.status==="ANSWERED"&&r.score!==null).map(r=>r.score!);
  return {sent,answered:scores.length,pending:rows.filter(r=>r.status==="PENDING").length,waiting:rows.filter(r=>r.status==="SENT").length,unconfirmed:rows.filter(r=>["UNKNOWN","SENDING"].includes(r.status)).length,average:scores.length?Number((scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1)):null,responseRate:sent?Math.round(scores.length/sent*100):0,distribution:[1,2,3,4,5].map(score=>({score,count:scores.filter(s=>s===score).length}))};
}
