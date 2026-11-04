export const PROFILE_HINT_KEY="fortuno:login-profile";
export const REMEMBER_HINT_KEY="fortuno:remember-profile";
export type LoginProfileHint={name:string;email:string;avatar:string|null;day:string};
export function loginDay(now=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);}
export function parseLoginHint(raw:string|null,now=new Date()):LoginProfileHint|null{
 try{const value=JSON.parse(raw||"null");if(!value||value.day!==loginDay(now)||typeof value.name!=="string"||value.name.length>300||typeof value.email!=="string"||value.email.length>254||!/^\S+@\S+\.\S+$/.test(value.email))return null;
 const avatar=typeof value.avatar==="string"&&value.avatar.length<=180000&&value.avatar.startsWith("data:image/jpeg;base64,")?value.avatar:null;
 return {name:value.name,email:value.email,avatar,day:value.day};}catch{return null;}
}
export function rememberLoginProfile(user:{name:string;email:string;avatar?:string|null},day=loginDay()){
 try{if(localStorage.getItem(REMEMBER_HINT_KEY)==="false"){localStorage.removeItem(PROFILE_HINT_KEY);return;}localStorage.setItem(PROFILE_HINT_KEY,JSON.stringify({name:user.name,email:user.email,avatar:user.avatar||null,day}));}catch{}
}
