export function cleanMeetingMarkdown(source:string){
 return source.replace(/\r\n?/g,"\n").replace(/&#(?:x20|32);|&nbsp;/gi," ").replace(/&amp;/gi,"&")
  .replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g,(_all,label:string,url:string)=>{
   try{const host=new URL(url).hostname.toLowerCase();if(["fathom.video","fathom.ai","app.fathom.ai"].includes(host))return /^\s*(?:\d{1,2}:){1,2}\d{2}\s*$/.test(label)?"":label;}catch{}
   return label;
  }).replace(/https?:\/\/(?:app\.)?fathom\.(?:video|ai)\/[^\s<>]+/gi,"")
  .replace(/[ \t]+$/gm,"").replace(/\n{3,}/g,"\n\n").trim();
}
export function plainMeetingText(text:string){return cleanMeetingMarkdown(text).replace(/\*\*([^*]+)\*\*/g,"$1").replace(/__([^_]+)__/g,"$1").replace(/(^|[^*])\*([^*]+)\*/g,"$1$2").replace(/^#{1,6}\s*/gm,"");}
export function groupMeetingAssignments(content:string){
 const lines=content.replace(/\r\n?/g,"\n").split("\n"),start=lines.findIndex(line=>/^## Atividades distribuídas\s*$/.test(line));
 if(start<0)return content;
 let end=start+1;while(end<lines.length&&!/^##\s/.test(lines[end]))end++;
 const section=lines.slice(start+1,end);if(section.some(line=>/^####\s/.test(line)))return content;
 const groups=new Map<string,string[][]>();let task:string[]=[];
 const append=()=>{if(!task.length)return;const owner=task.find(line=>/^Responsável:\s*/.test(line))?.replace(/^Responsável:\s*/,"").trim()||"Sem responsável";const rows=groups.get(owner)||[];rows.push(task);groups.set(owner,rows);task=[];};
 for(const line of section){if(/^###\s/.test(line)){append();task=[line];}else if(task.length)task.push(line);}append();
 if(!groups.size)return content;
 const grouped=["## Atividades distribuídas",""];
 for(const [owner,tasks] of groups){grouped.push("### "+owner,"");for(const rows of tasks)grouped.push(rows[0].replace(/^### /,"#### "),...rows.slice(1).filter(line=>!/^Responsável:/.test(line)),"");}
 return [...lines.slice(0,start),...grouped,...lines.slice(end)].join("\n");
}
export function readableMeetingReport(content:string){return cleanMeetingMarkdown(groupMeetingAssignments(content));}
export type MeetingTextBlock={kind:"heading"|"paragraph"|"bullet";text:string;level:number};
export function meetingTextBlocks(content:string):MeetingTextBlock[]{
 return cleanMeetingMarkdown(content).split("\n").flatMap<MeetingTextBlock>(line=>{
  if(!line.trim()||/^\s*[-*_]{3,}\s*$/.test(line))return [];
  const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading)return [{kind:"heading" as const,text:heading[2],level:heading[1].length}];
  const bullet=line.match(/^(\s*)(?:[-*•]|\d+[.)])\s+(.+)$/);if(bullet)return [{kind:"bullet" as const,text:bullet[2],level:Math.min(6,Math.floor(bullet[1].replace(/\t/g,"  ").length/2))}];
  return [{kind:"paragraph" as const,text:line.trim(),level:0}];
 });
}
