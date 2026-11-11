export function mentionedNumbers(body:string,to:string){
 if(!to.endsWith("@g.us"))return undefined;
 const numbers=[...new Set([...body.matchAll(/(?:^|\s)@(\d{8,15})(?=\s|$|[.,!?:;])/g)].map(match=>match[1]))].slice(0,50);
 return numbers.length?numbers.join(","):undefined;
}
