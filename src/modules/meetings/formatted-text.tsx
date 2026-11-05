import {Fragment} from "react";
import {Stack,Text,Title} from "@mantine/core";
import {meetingTextBlocks} from "./meeting-text";
function Inline({text}:{text:string}){return <>{text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).map((part,index)=>/^(?:\*\*|__)/.test(part)?<strong key={index}>{part.slice(2,-2)}</strong>:<Fragment key={index}>{part}</Fragment>)}</>;}
export function FormattedMeetingText({text}:{text:string}){
 return <Stack gap="sm" style={{overflowWrap:"anywhere",lineHeight:1.65}}>{meetingTextBlocks(text).map((block,index)=>block.kind==="heading"?<Title key={index} order={block.level<=1?3:block.level===2?4:5} mt={index?"md":0} pb={block.level===3?6:0} style={block.level===3?{borderBottom:"1px solid var(--mantine-color-default-border)"}:undefined}><Inline text={block.text}/></Title>:block.kind==="bullet"?<div key={index} style={{display:"flex",gap:9,marginLeft:12+block.level*20}}><span aria-hidden="true">•</span><Text size="sm" component="div"><Inline text={block.text}/></Text></div>:<Text key={index} size="sm" style={{whiteSpace:"pre-wrap"}}><Inline text={block.text}/></Text>)}</Stack>;
}
