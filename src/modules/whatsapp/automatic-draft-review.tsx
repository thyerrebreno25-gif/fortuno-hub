"use client";
import { useEffect, useState } from "react";
import { Button, Group, Menu, Stack, Text } from "@mantine/core";
import { IconDots, IconWriting } from "@tabler/icons-react";
import { draftReviewDelay, draftReviewStorageKey } from "./draft-review-timing";
import { reviewWhatsAppDraft } from "./draft-review";

type Review = { source: string; corrected: string; suggestions: string[] };
export function AutomaticDraftReview({ text, disabled, onApply }: { text:string; disabled:boolean; onApply:(text:string)=>void }) {
  const [enabled,setEnabled]=useState(true),[result,setResult]=useState<Review|null>(null);
  useEffect(()=>{let active=true;queueMicrotask(()=>{if(active)try{setEnabled(localStorage.getItem(draftReviewStorageKey)!=="off");}catch{/* Default on. */}});return()=>{active=false;};},[]);
  useEffect(()=>{
    const delay=draftReviewDelay(text);
    if(!enabled||disabled||delay===null)return;
    const timer=window.setTimeout(()=>setResult({...reviewWhatsAppDraft(text),source:text}),delay);
    return()=>window.clearTimeout(timer);
  },[text,disabled,enabled]);
  function toggle(){const next=!enabled;setEnabled(next);try{localStorage.setItem(draftReviewStorageKey,next?"on":"off");}catch{/* Browser storage is optional. */}}
  const review=result?.source===text?result:null;
  const choices=review?[{text:review.corrected,label:"Aplicar correção"},...review.suggestions.map(text=>({text,label:"Usar sugestão"}))].filter((item,index,all)=>item.text!==text&&all.findIndex(other=>other.text===item.text)===index):[];
  return <div style={{gridColumn:"1 / -1",minWidth:0}}><Stack gap={4}>
    <Group justify="space-between" gap="xs"><Group gap={5}><IconWriting size={13}/><Text size="xs" c="dimmed" aria-live="polite">{!enabled?"Revisão automática desativada":choices.length?"Sugestões de escrita · revisão local":"Revisão automática local"}</Text></Group><Menu position="top-end"><Menu.Target><Button size="compact-xs" variant="subtle" aria-label="Opções da revisão automática"><IconDots size={15}/></Button></Menu.Target><Menu.Dropdown><Menu.Label>Regras locais + corretor do navegador</Menu.Label><Menu.Label>Sugestões do Hub calculadas neste navegador</Menu.Label><Menu.Item onClick={toggle}>{enabled?"Desativar revisão automática":"Ativar revisão automática"}</Menu.Item></Menu.Dropdown></Menu></Group>
    {enabled&&choices.slice(0,2).map((item,index)=><Group key={index} align="flex-start" wrap="nowrap" gap="xs"><Text size="xs" style={{flex:1,whiteSpace:"pre-wrap",overflowWrap:"anywhere",maxHeight:64,overflowY:"auto"}}>{item.text}</Text><Button variant="light" size="compact-xs" disabled={disabled} onClick={()=>{onApply(item.text);setResult(null);}}>{item.label}</Button></Group>)}
  </Stack></div>;
}
