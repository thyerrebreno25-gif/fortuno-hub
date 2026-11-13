"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Group, Loader, Menu, Stack, Text } from "@mantine/core";
import { IconDots, IconWriting } from "@tabler/icons-react";
import { draftReviewDelay, draftReviewStorageKey } from "./draft-review-timing";

type Review = { source: string; corrected: string; suggestions: string[] };
export function AutomaticDraftReview({ ticketId, text, internal, disabled, onApply }: { ticketId:string; text:string; internal:boolean; disabled:boolean; onApply:(text:string)=>void }) {
  const [enabled,setEnabled]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[result,setResult]=useState<Review|null>(null);
  const sequence=useRef(0),lastStarted=useRef(0);
  useEffect(()=>{void Promise.resolve().then(()=>{try{setEnabled(localStorage.getItem(draftReviewStorageKey)!=="off");}catch{/* Default on. */}});},[]);
  useEffect(()=>{
    let active=true;
    const current=++sequence.current;
    const delay=draftReviewDelay(text,lastStarted.current,Date.now());
    const controller=new AbortController();
    if(!enabled||disabled||delay===null) {queueMicrotask(()=>{if(active&&current===sequence.current){setBusy(false);setError("");}});return()=>{active=false;};}
    const timer=window.setTimeout(async()=>{
      lastStarted.current=Date.now();setBusy(true);setError("");
      try{
        const response=await fetch("/api/whatsapp/draft-review",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticketId,text,internal}),signal:controller.signal});
        const review=await response.json();
        if(!response.ok){if(response.status===429||response.status===503)lastStarted.current=Date.now()+60000;throw Error(review.error||"Revisão indisponível.");}
        if(active&&sequence.current===current)setResult({...review,source:text});
      }catch(error){if(active&&sequence.current===current&&!controller.signal.aborted)setError(error instanceof Error?error.message:"Revisão indisponível.");}
      finally{if(active&&sequence.current===current)setBusy(false);}
    },delay);
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[text,ticketId,internal,disabled,enabled]);
  function toggle(){const next=!enabled;setEnabled(next);try{localStorage.setItem(draftReviewStorageKey,next?"on":"off");}catch{/* Browser storage is optional. */}}
  const review=result?.source===text?result:null;
  const choices=review?[review.corrected,...review.suggestions].filter((value,index,all)=>value!==text&&all.indexOf(value)===index):[];
  return <div style={{gridColumn:"1 / -1",minWidth:0}}><Stack gap={4}>
    <Group justify="space-between" gap="xs"><Group gap={5}><IconWriting size={13}/><Text size="xs" c="dimmed" aria-live="polite">{!enabled?"Revisão automática desativada":busy?"Revisando escrita…":error?"Revisão indisponível":review&&!choices.length?"Escrita revisada":"Revisão automática · IA"}</Text>{enabled&&busy&&<Loader size={10}/>}</Group><Menu position="top-end"><Menu.Target><Button size="compact-xs" variant="subtle" aria-label="Opções da revisão automática"><IconDots size={15}/></Button></Menu.Target><Menu.Dropdown><Menu.Label>Somente o rascunho é analisado pela IA</Menu.Label><Menu.Item onClick={toggle}>{enabled?"Desativar revisão automática":"Ativar revisão automática"}</Menu.Item></Menu.Dropdown></Menu></Group>
    {enabled&&error&&<Text size="xs" c="dimmed">{error}</Text>}
    {enabled&&choices.slice(0,3).map((value,index)=><Group key={index} align="flex-start" wrap="nowrap" gap="xs"><Text size="xs" style={{flex:1,whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:84,overflowY:"auto"}}>{value}</Text><Button variant="light" size="compact-xs" disabled={disabled} onClick={()=>{onApply(value);setResult(null);}}>{index===0?"Aplicar correção":"Usar sugestão"}</Button></Group>)}
  </Stack></div>;
}
