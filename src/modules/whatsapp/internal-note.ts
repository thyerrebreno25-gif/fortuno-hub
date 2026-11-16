export type InternalNote={kind:"comment"|"transfer"|"resolved";title:string;body:string;destination?:string;sector?:string};
export function internalNote(type:string|null|undefined,text:string|null,actor:string):InternalNote{
 const body=text||"";
 const transfer=body.match(/^Transferência interna: ([^\n]+?) → ([^\n]+?) · ([^\n]+?)\.(?:\n([\s\S]*))?$/);
 if((type==="WHATSAPP_TRANSFER"||!type)&&transfer&&transfer[1]===actor)return {kind:"transfer",title:"Transferência",destination:transfer[2],sector:transfer[3],body:transfer[4]||""};
 if(type==="WHATSAPP_RESOLVED"||!type&&/^Chamado finalizado em .+ por .+\.$/.test(body))return {kind:"resolved",title:"Chamado finalizado",body:""};
 return {kind:"comment",title:"Nota interna",body};
}
