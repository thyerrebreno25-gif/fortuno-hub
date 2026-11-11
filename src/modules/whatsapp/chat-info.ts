import {object,text} from "./uazapi";
import {safeAvatarUrl} from "./avatar-url";
export function chatProfile(body:unknown,group:boolean){
 const root=object(body), row=group?object(root.group||body):object(root.chat||body);
 const count=Number(row.ParticipantCount);
 const created=typeof row.GroupCreated==="string"?Date.parse(row.GroupCreated):NaN;
 const participants=group&&Array.isArray(row.Participants)?row.Participants.slice(0,2000).flatMap(value=>{const person=object(value),jid=text(person.PhoneNumber||person.JID||person.jid,100);const phone=jid.replace(/@s\.whatsapp\.net$/,"");return /^\d{8,15}$/.test(phone)?[{phone,name:text(person.Name||person.name||person.DisplayName,150)||phone}]:[];}):[];
 return {participants,name:text(group?row.Name||row.name:row.name||row.wa_contactName||row.wa_name,250)||null,
 description:group?(row.TopicDeleted===true?null:text(row.Topic,10000)||null):text(row.about||row.wa_about,2000)||null,
 memberCount:group?(row.ParticipantCount!==undefined&&row.ParticipantCount!==null&&Number.isSafeInteger(count)&&count>=0?count:Array.isArray(row.Participants)?row.Participants.length:null):null,
 createdAt:Number.isFinite(created)?new Date(created).toISOString():null,
 photo:safeAvatarUrl(row.image||row.imagePreview),businessName:!group&&row.is_business===true?text(row.business_name,250)||null:null};
}
