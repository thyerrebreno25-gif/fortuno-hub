export type ComposerSelection={start:number;end:number};
export function mentionAtCursor(value:string,cursor:number){
 const at=Math.max(0,Math.min(cursor,value.length)),prefix=value.slice(0,at),match=/(?:^|[\s(])@([\p{L}\p{N}_-]{0,50})$/u.exec(prefix);
 if(!match)return null;
 const start=at-match[1].length-1;
 return {start,end:at,query:match[1]};
}
export function insertComposerText(value:string,text:string,selection:ComposerSelection){
 const start=Math.max(0,Math.min(selection.start,value.length)),end=Math.max(start,Math.min(selection.end,value.length));
 const next=value.slice(0,start)+text+value.slice(end);return next.length>5000?null:{value:next,cursor:start+text.length};
}
