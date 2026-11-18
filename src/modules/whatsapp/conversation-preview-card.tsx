"use client";
import {Button,Group,Loader,Popover,Stack,Text} from "@mantine/core";
import {useEffect,useRef,useState} from "react";
import type {ConversationPreview} from "./conversation-preview";
import styles from "./monitoring-attention.module.css";

export function ConversationPreviewCard({id,name,version,opened,onChange,onOpen}:{id:string;name:string;version:string;opened:boolean;onChange:(open:boolean)=>void;onOpen:()=>void}) {
 const [data,setData]=useState<ConversationPreview|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[retry,setRetry]=useState(0);
 const cache=useRef<{version:string;at:number;data:ConversationPreview}|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 function cancel(){if(timer.current)clearTimeout(timer.current);}
 function schedule(open:boolean){cancel();timer.current=setTimeout(()=>onChange(open),open?250:200);}
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 useEffect(()=>{
  if(!opened)return;
  const controller=new AbortController();
  async function read(){
   setError("");
   if(cache.current?.version===version&&Date.now()-cache.current.at<30000){setData(cache.current.data);setLoading(false);return;}
   setLoading(true);setData(null);
   try{
    const response=await fetch(`/api/whatsapp/${encodeURIComponent(id)}/preview`,{cache:"no-store",signal:controller.signal});
    const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível carregar a prévia.");
    if(controller.signal.aborted)return;
    cache.current={version,at:Date.now(),data:body.preview};setData(body.preview);
   }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Não foi possível carregar a prévia.");}
   finally{if(!controller.signal.aborted)setLoading(false);}
  }
  void read();return()=>controller.abort();
 },[opened,id,version,retry]);
 return <Popover opened={opened} onChange={onChange} width={440} position="right-start" withinPortal shadow="lg" radius="md" withArrow>
  <Popover.Target><button className={styles.contact} onMouseEnter={()=>schedule(true)} onMouseLeave={()=>schedule(false)} onFocus={()=>{cancel();onChange(true);}} onBlur={()=>schedule(false)} onKeyDown={event=>{if(event.key==="Escape"){cancel();onChange(false);}}} onClick={()=>{cancel();onChange(true);}} aria-label={`Ver prévia de ${name}`} aria-expanded={opened}>{name}</button></Popover.Target>
  <Popover.Dropdown className={styles.preview} onMouseEnter={cancel} onMouseLeave={()=>schedule(false)} onFocusCapture={cancel} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))schedule(false);}}>
   <Text fw={750} size="sm" lineClamp={1}>{name}</Text><Text size="xs" c="dimmed" mb="sm">Últimas mensagens · somente leitura</Text>
   {loading?<Group p="md"><Loader size="sm"/><Text size="sm">Carregando conversa…</Text></Group>:error?<Stack gap="xs"><Text size="sm" c="red">{error}</Text><Button variant="subtle" size="xs" onClick={()=>setRetry(value=>value+1)}>Tentar novamente</Button></Stack>:<div className={styles.messages}>{data?.messages.map(message=><div key={message.id} className={`${styles.message} ${message.direction==="OUTBOUND"?styles.outbound:message.direction==="INTERNAL"?styles.internal:""}`}>
    <Group justify="space-between" gap="xs"><Text size="xs" fw={700} lineClamp={1}>{message.direction==="INTERNAL"?"Interno · ":""}{message.author}</Text><Text size="10px" c="dimmed">{new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(message.at))}</Text></Group>
    {message.deleted&&<Text size="xs" c="dimmed">Mensagem excluída</Text>}<Text size="sm" lineClamp={3} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{message.body}</Text>
    {message.attachments.map((file,index)=><Text key={index} size="xs" c="dimmed" lineClamp={1}>Anexo: {file.name}</Text>)}
   </div>)}{data&&!data.messages.length&&<Text size="sm" c="dimmed">Nenhuma mensagem disponível.</Text>}</div>}
   <Group justify="space-between" mt="sm"><Text size="xs" c="dimmed">A prévia não marca como lida.</Text><Button size="xs" variant="light" onClick={onOpen}>Abrir conversa</Button></Group>
  </Popover.Dropdown>
 </Popover>;
}
