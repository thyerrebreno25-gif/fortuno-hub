import { z } from "zod";
export const DEFAULT_SURVEY_MESSAGE="Olá! Queremos ouvir sua opinião sobre o atendimento da nossa equipe. Avalie de 1 a 5 e, se quiser, deixe um comentário: {{link}}\nSua participação é opcional. Obrigado!";
export const surveyPolicySchema=z.object({enabled:z.boolean(),cadenceDays:z.number().int().min(7).max(90),delayMinutes:z.number().int().min(15).max(240),message:z.string().trim().min(20).max(1000).refine(s=>(s.match(/\{\{link\}\}/g)||[]).length===1,"Inclua {{link}} uma única vez.")});
export const surveyAnswerSchema=z.object({score:z.number().int().min(1).max(5).optional(),comment:z.string().trim().max(1000).default(""),decline:z.boolean().default(false),optOut:z.boolean().default(false)}).refine(v=>v.decline || v.score!==undefined);
// Fixed Brasília timezone. Surveys are sent only Mon–Fri, 09:00–17:00.
export function nextSurveyBusinessTime(date:Date) {
  const local=new Date(date.getTime()-3*3600000);const day=local.getUTCDay(),hour=local.getUTCHours();
  if(day!==0&&day!==6&&hour>=9&&hour<17)return new Date(date);
  if(day===0||day===6||hour>=17)local.setUTCDate(local.getUTCDate()+1);
  local.setUTCHours(9,0,0,0);while([0,6].includes(local.getUTCDay()))local.setUTCDate(local.getUTCDate()+1);
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
