"use client";
import {useEffect,useRef,useState} from "react";
import {Alert,Badge,Button,Group,Modal,MultiSelect,Progress,Stack,Text,TextInput} from "@mantine/core";
import {IconUserPlus} from "@tabler/icons-react";
import {groupParticipantInput} from "./group-management-policy";
import {addGroupParticipantBatch,type GroupParticipantBatchResult} from "./group-participant-batch";

type Option={value:string;label:string};

export function AddGroupParticipant({ticketId,groupJid,groupName,allowed,disabled,onChanged}:{ticketId:string;groupJid:string;groupName:string;allowed:boolean;disabled:boolean;onChanged:()=>void}){
 const current={value:ticketId,label:groupName};
 const [opened,setOpened]=useState(false),[number,setNumber]=useState(""),[contactName,setContactName]=useState(""),[groups,setGroups]=useState<string[]>([ticketId]),[search,setSearch]=useState(""),[options,setOptions]=useState<Option[]>([current]),[results,setResults]=useState<GroupParticipantBatchResult[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[directoryError,setDirectoryError]=useState("");
 const alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  if(!opened)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{void fetch("/api/whatsapp/directory?"+new URLSearchParams({kind:"GROUP",search,page:"1"}),{signal:controller.signal,cache:"no-store"}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível consultar os grupos.");return body;}).then(body=>{if(controller.signal.aborted)return;const rows=(body.entries||[]).filter((row:{externalId:string})=>row.externalId!==groupJid).map((row:{id:string;displayName:string})=>({value:"directory:"+row.id,label:row.displayName}));setOptions(previous=>[...new Map([...previous,...rows].map(row=>[row.value,row])).values()]);setDirectoryError("");}).catch(error=>{if(!controller.signal.aborted)setDirectoryError(error instanceof Error?error.message:"Não foi possível consultar os grupos.");});},250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[opened,search,groupJid]);
 async function add(){
  const requestId=crypto.randomUUID(),input=groupParticipantInput.safeParse({action:"add",participant:number,requestId});
  if(!input.success){setError("Informe o telefone completo com DDI e DDD.");return;}
  if(input.data.action!=="add")return;
  setBusy(true);setError("");
  if(contactName.trim()){
   try{const response=await fetch("/api/whatsapp/contacts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:input.data.participant,name:contactName.trim()})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível salvar o nome do contato.");}
   catch(error){setError(error instanceof Error?error.message:"Não foi possível salvar o contato.");setBusy(false);return;}
  }
  await addGroupParticipantBatch(groups.map(id=>({id,name:options.find(row=>row.value===id)?.label||"Grupo"})),input.data,result=>setResults(previous=>[...previous,result]),()=>alive.current);
  if(alive.current){setBusy(false);onChanged();}
 }
 return <>{allowed&&<Button size="compact-xs" variant="light" leftSection={<IconUserPlus size={15}/>} disabled={disabled} onClick={()=>{setNumber("");setContactName("");setGroups([ticketId]);setOptions([current]);setSearch("");setResults([]);setError("");setOpened(true);}}>Adicionar participante</Button>}
  <Modal opened={opened} onClose={()=>!busy&&setOpened(false)} title="Adicionar participante a grupos" centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack>
   <TextInput label="Nome do contato (opcional)" description="Se preenchido, salva o nome na agenda do WhatsApp antes de adicionar aos grupos." value={contactName} onChange={event=>setContactName(event.currentTarget.value)} maxLength={150} disabled={busy||results.length>0}/>
   <TextInput label="Telefone com DDI e DDD" placeholder="+55 61 99999-9999" value={number} onChange={event=>setNumber(event.currentTarget.value)} maxLength={40} disabled={busy||results.length>0}/>
   <MultiSelect label="Grupos de destino" description="Selecione até 25 grupos. Digite o nome para buscar outros grupos da agenda." searchable searchValue={search} onSearchChange={setSearch} data={options} value={groups} onChange={setGroups} maxValues={25} disabled={busy||results.length>0} nothingFoundMessage="Nenhum grupo encontrado"/>
   {directoryError&&<Alert color="orange">{directoryError}</Alert>}
   {error&&<Alert color="red">{error}</Alert>}
   {results.length>0&&<><Progress value={results.length/Math.max(groups.length,1)*100}/><Text size="sm">{results.length} de {groups.length} grupos processados · {results.filter(row=>row.ok).length} inclusão(ões) confirmada(s)</Text><Stack gap="xs">{results.map(row=><Alert key={row.id} color={row.ok?"green":"orange"} title={<Group gap="xs"><Text size="sm" fw={700}>{row.name}</Text><Badge size="xs" color={row.ok?"green":"orange"}>{row.ok?"Confirmado":"Não confirmado"}</Badge></Group>}>{row.message}</Alert>)}</Stack></>}
   <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>setOpened(false)}>{results.length?"Fechar":"Cancelar"}</Button>{!results.length&&<Button loading={busy} disabled={!number.trim()||!groups.length} onClick={()=>void add()}>Adicionar em {groups.length} grupo(s)</Button>}</Group>
  </Stack></Modal></>;
}
