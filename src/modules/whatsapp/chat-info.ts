import {isContactName} from "./contact-name";
import {groupMembers} from "./group-members";
import {object,text} from "./uazapi";
import {safeAvatarUrl} from "./avatar-url";
export function chatProfile(body:unknown,group:boolean){
 const root=object(body), row=group?object(root.group||body):object(root.chat||body);
 const count=Number(row.ParticipantCount);
 const created=typeof row.GroupCreated==="string"?Date.parse(row.GroupCreated):NaN;
 const participants=group?groupMembers(row.Participants||row.participants,row.participant_profiles||root.participant_profiles):[];
 return {accountIsAdmin:group&&row.OwnerIsAdmin===true,ownerId:group?text(row.OwnerPN||row.OwnerJID,150)||null:null,participants,participantsAvailable:group&&(Array.isArray(row.Participants)||Array.isArray(row.participants)||Array.isArray(row.participant_profiles)||Array.isArray(root.participant_profiles)),name:group?text(row.Name||row.name,250)||null:[row.wa_contactName,row.name,row.wa_name,row.lead_fullName,row.lead_name].map(value=>text(value,250)).find(isContactName)||null,
 description:group?(row.TopicDeleted===true?null:text(row.Topic,10000)||null):text(row.about||row.wa_about,2000)||null,
 memberCount:group?(row.ParticipantCount!==undefined&&row.ParticipantCount!==null&&Number.isSafeInteger(count)&&count>=0?count:(Array.isArray(row.Participants)||Array.isArray(row.participants)||Array.isArray(row.participant_profiles)||Array.isArray(root.participant_profiles))?participants.length:null):null,
 createdAt:Number.isFinite(created)?new Date(created).toISOString():null,
 photo:safeAvatarUrl(row.image||row.imagePreview),businessName:!group&&row.is_business===true?text(row.business_name,250)||null:null};
}
