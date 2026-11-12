import {isContactName} from "./contact-name";
import {safeAvatarUrl} from "./avatar-url";
export type GroupMember={id:string;phone:string|null;lid:string|null;name:string|null;isAdmin:boolean;isSuperAdmin:boolean;photo:string|null};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==="string"?value.trim().slice(0,250):"";
const flag=(value:unknown)=>value===true||value===1||value==="true";
const jid=(value:unknown)=>{const v=text(value);return /^\d{8,15}$/.test(v)?v+"@s.whatsapp.net":/^\d+@(s\.whatsapp\.net|lid)$/.test(v)?v:"";};
const aliases=(row:Record<string,unknown>)=>[row.JID,row.jid,row.PhoneNumber,row.pn,row.LID,row.lid].map(jid).filter(Boolean);
const displayName=(...values:unknown[])=>values.map(text).find(isContactName)||null;
export function groupMembers(participants:unknown,profiles:unknown):GroupMember[]{
 if(!Array.isArray(participants))return [];
 const profileById=new Map<string,Record<string,unknown>>();
 if(Array.isArray(profiles))for(const item of profiles.slice(0,2000)){const profile=object(item);for(const id of aliases(profile))profileById.set(id,profile);}
 const byAlias=new Map<string,GroupMember>(),members:GroupMember[]=[];
 for(const item of participants.slice(0,2000)){
  const person=object(item),ids=aliases(person),profile=ids.map(id=>profileById.get(id)).find(Boolean)||{};
  const all=[...new Set([...ids,...aliases(profile)])];if(!all.length)continue;
  const phoneJid=all.find(id=>id.endsWith("@s.whatsapp.net")),lid=all.find(id=>id.endsWith("@lid"))||null;
  const previous=all.map(id=>byAlias.get(id)).find(Boolean);
  const next:GroupMember={id:phoneJid||lid!,phone:phoneJid?.split("@")[0]||null,lid,name:displayName(person.DisplayName,person.Name,person.name,profile.display_name,profile.name),isAdmin:flag(person.IsAdmin)||flag(profile.is_admin),isSuperAdmin:flag(person.IsSuperAdmin)||flag(profile.is_super_admin),photo:safeAvatarUrl(profile.image_preview_url||profile.image_url)};
  const member=previous||next;
  if(previous){member.phone ||= next.phone;member.lid ||=next.lid;member.name ||=next.name;member.photo ||=next.photo;member.isAdmin ||=next.isAdmin;member.isSuperAdmin ||=next.isSuperAdmin;}
  else members.push(member);
  for(const id of all)byAlias.set(id,member);
 }
 return members;
}
export function memberAliases(member:GroupMember){return [...new Set([member.id,member.lid,member.phone?member.phone+"@s.whatsapp.net":null].filter((id):id is string=>Boolean(id)))];}
export function enrichGroupMemberNames(members:GroupMember[],savedNames:Map<string,string>,senderNames:Map<string,string>){
 return members.map(member=>{const ids=memberAliases(member),saved=ids.map(id=>savedNames.get(id)).find(isContactName),sender=ids.map(id=>senderNames.get(id)).find(isContactName);return {...member,name:saved||member.name||sender||null};});
}
