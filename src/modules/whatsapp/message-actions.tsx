"use client";
import {useEffect,useRef,useState} from "react";
import {ActionIcon,Alert,Menu,Modal,Stack,Textarea,Button,Text,Group,Tooltip} from "@mantine/core";
import {IconDots,IconEdit,IconTrash} from "@tabler/icons-react";
import {notifications} from "@mantine/notifications";
import {MESSAGE_EDIT_MS,messageEditProblem,type MessageMutation} from "./message-edit";
export function MessageActions({conversationId,message,onChanged}:{conversationId:string;message:{id:string;textBody:string|null;receivedAt:string;deliveryStatus?:string|null;attachments:unknown[]};onChanged?:(update?:MessageMutation)=>void}){
 const [mode,setMode]=useState<"edit"|"delete"|null>(null),[value,setValue]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[now,setNow]=useState(Date.now);
 const pending=useRef(false);
 const [original,setOriginal]=useState("");
 useEffect(()=>{const remaining=new Date(message.receivedAt).getTime()+MESSAGE_EDIT_MS-Date.now();if(!Number.isFinite(remaining)||remaining<=0)return;const timer=window.setTimeout(()=>setNow(Date.now()),remaining+10);return()=>clearTimeout(timer);},[message.receivedAt]);
 const problem=messageEditProblem(message,now);
 function edit(){const previous=message.textBody||"";setOriginal(previous);setValue(previous);setError("");setNow(Date.now());setMode("edit");}
 async function save(){
  if(pending.current||!mode)return;
  const blocked=mode==="edit"?messageEditProblem(message):null;
  if(blocked){setError(blocked);return;}
  pending.current=true;setBusy(true);setError("");
  try{
   const response=await fetch(`/api/whatsapp/${conversationId}/messages/${message.id}`,{method:mode==="edit"?"PATCH":"DELETE",headers:{"Content-Type":"application/json"},...(mode==="edit"?{body:JSON.stringify({text:value,originalText:original})}:{})});
   const body=await response.json().catch(()=>null);
   if(!response.ok||!body?.messageId)throw new Error(body?.error||"Não foi possível confirmar a alteração. Confira a mensagem antes de tentar novamente.");
   onChanged?.(body as MessageMutation);setMode(null);
   notifications.show({color:"green",message:mode==="edit"?"Mensagem editada no WhatsApp.":"Mensagem excluída no WhatsApp."});
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível alterar a mensagem.");}
  finally{pending.current=false;setBusy(false);}
 }
 return <><Group gap={2} wrap="nowrap">
  {!message.attachments.length&&<Tooltip label={problem||"Editar mensagem · até 15 minutos após o envio"}><span><ActionIcon variant="subtle" size="sm" color="gray" aria-label="Editar mensagem" disabled={Boolean(problem)||busy} onClick={edit}><IconEdit size={15}/></ActionIcon></span></Tooltip>}
  <Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon variant="subtle" size="sm" color="gray" aria-label="Opções da mensagem"><IconDots size={16}/></ActionIcon></Menu.Target><Menu.Dropdown>{!message.attachments.length&&<Menu.Item leftSection={<IconEdit size={15}/>} disabled={Boolean(problem)} onClick={edit}>Editar mensagem{problem&&<Text size="xs" c="dimmed">{problem}</Text>}</Menu.Item>}<Menu.Item color="red" leftSection={<IconTrash size={15}/>} onClick={()=>{setError("");setMode("delete");}}>Excluir para todos</Menu.Item></Menu.Dropdown></Menu>
 </Group><Modal opened={Boolean(mode)} onClose={()=>{if(!busy)setMode(null);}} title={mode==="edit"?"Editar mensagem":"Excluir mensagem para todos?"} centered><Stack>
  {mode==="edit"?<><Text size="sm" c="dimmed">A alteração será aplicada à mesma mensagem no WhatsApp. Ela ficará identificada como editada.</Text><Textarea label="Mensagem" value={value} onChange={e=>setValue(e.currentTarget.value)} maxLength={10000} autosize minRows={3} disabled={busy}/>{problem&&<Alert color="orange">{problem}</Alert>}</>:<Text size="sm">A mensagem será excluída no WhatsApp. O conteúdo continuará no histórico interno do Hub com a identificação de excluído.</Text>}
  {error&&<Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>setMode(null)}>Cancelar</Button><Button color={mode==="delete"?"red":"blue"} loading={busy} disabled={busy||mode==="edit"&&(!value.trim()||value.trim()===original.trim()||Boolean(problem))} onClick={()=>void save()}>{mode==="edit"?"Salvar alteração":"Excluir para todos"}</Button></Group>
 </Stack></Modal></>;
}
