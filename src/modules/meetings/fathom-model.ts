import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const fathomMeetingSchema = z.object({
 recording_id:z.number().int().positive(), title:z.string().max(1000), meeting_url:z.string().nullable().optional(),
 url:z.string().max(2000), scheduled_start_time:z.string().nullable().optional(), recording_start_time:z.string(),
 transcript:z.array(z.object({speaker:z.object({display_name:z.string().max(500)}),timestamp:z.string().max(30),text:z.string().max(100000)})).max(50000).nullable().optional(),
 default_summary:z.object({markdown_formatted:z.string().max(2000000).nullable()}).nullable().optional(),
 action_items:z.array(z.object({description:z.string().max(20000),assignee:z.object({name:z.string().nullable().optional(),email:z.string().nullable().optional()}).nullable().optional()})).max(1000).nullable().optional(),
});
export type FathomMeeting = z.infer<typeof fathomMeetingSchema>;
export function meetCode(value:string|null|undefined){
 if(!value)return null;
 try{const url=new URL(value.trim());return url.protocol==="https:"&&url.hostname==="meet.google.com"&&/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/i.test(url.pathname)?url.pathname.replaceAll("/","").toLowerCase():null;}catch{return null;}
}
export function fathomPlaybackUrl(value:string){try{const url=new URL(value);return url.protocol==="https:"&&["fathom.video","fathom.ai","app.fathom.ai"].includes(url.hostname)&&!url.username&&!url.password?url.href:null;}catch{return null;}}
export function matchesFathomMeeting(meeting:{meetLink:string;location:string;startsAt:Date;endsAt:Date},recording:FathomMeeting){
 const code=meetCode(recording.meeting_url);if(!code||code!==(meetCode(meeting.meetLink)||meetCode(meeting.location)))return false;
 const scheduled=Date.parse(recording.scheduled_start_time||"");
 const recorded=Date.parse(recording.recording_start_time);
 return Number.isFinite(recorded)&&(Number.isFinite(scheduled)?Math.abs(scheduled-meeting.startsAt.getTime())<=15*60000:recorded>=meeting.startsAt.getTime()-15*60000&&recorded<=meeting.endsAt.getTime()+15*60000);
}
export function verifyFathomWebhook(secret:string,headers:Headers,body:string,now=Date.now()){
 const id=headers.get("webhook-id"),timestamp=headers.get("webhook-timestamp"),signatures=headers.get("webhook-signature");
 if(!id||!timestamp||!/^\d+$/.test(timestamp)||!signatures||Math.abs(now/1000-Number(timestamp))>300||!secret.startsWith("whsec_"))return false;
 const expected=createHmac("sha256",Buffer.from(secret.slice(6),"base64")).update(id+"."+timestamp+"."+body).digest();
 return signatures.split(" ").some(value=>{if(!value.startsWith("v1,"))return false;const given=Buffer.from(value.slice(3),"base64");return expected.length===given.length&&timingSafeEqual(expected,given);});
}
export function fathomContent(recording:FathomMeeting){return {
 transcript:(recording.transcript||[]).map(row=>"["+row.timestamp+"] "+row.speaker.display_name+": "+row.text).join("\n"),
 summary:recording.default_summary?.markdown_formatted||"",
 actionItems:(recording.action_items||[]).map(row=>"• "+row.description+(row.assignee?.name||row.assignee?.email?" — Indicado pelo Fathom: "+(row.assignee.name||row.assignee.email):"")).join("\n"),
};}
