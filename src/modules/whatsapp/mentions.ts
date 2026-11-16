export function mentionedNumbers(body:string,to:string){
 if(!to.endsWith("@g.us"))return undefined;
 const numbers=[...new Set([...body.matchAll(/(?:^|\s)@(\d{8,15})(?=\s|$|[.,!?:;])/g)].map(match=>match[1]))].slice(0,50);
 return numbers.length?numbers.join(","):undefined;
}

export type MentionTarget={phone:string;name:string};
export function namedMentions(body:string,targets:unknown,memberPhones:Set<string>){
 if(!Array.isArray(targets)||targets.length>50)throw new Error("Revise os participantes mencionados.");
 let wireBody=body;
 const used:MentionTarget[]=[];
 const seen=new Set<string>();
 const valid=targets.map(row=>{
  if(!row||typeof row!=="object"||typeof row.phone!=="string"||!/^\d{8,15}$/.test(row.phone)||typeof row.name!=="string"||!row.name.trim()||row.name.length>250||/[\r\n]/.test(row.name))throw new Error("Menção inválida. Selecione o participante novamente.");
  return {phone:row.phone,name:row.name.trim()};
 }).sort((a,b)=>b.name.length-a.name.length);
 for(const target of valid){
  if(seen.has(target.name))continue;seen.add(target.name);
  const escaped=target.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const pattern=new RegExp("(^|\\s)@"+escaped+"(?=\\s|$|[.,!?:;])","g");
  if(!pattern.test(wireBody))continue;pattern.lastIndex=0;
  if(!memberPhones.has(target.phone))throw new Error("Um participante mencionado não está mais disponível neste grupo. Selecione novamente.");
  wireBody=wireBody.replace(pattern,(_,prefix:string)=>prefix+"@"+target.phone);used.push(target);
 }
 return {wireBody,targets:used};
}
