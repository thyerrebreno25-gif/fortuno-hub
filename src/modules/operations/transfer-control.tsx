"use client";
import {Alert,Button,Group,Loader,Modal,ScrollArea,Select,Stack,Text,Textarea} from "@mantine/core";
import {notifications} from "@mantine/notifications";
import {useEffect,useState} from "react";
type Row={id:string;title:string;updatedAt:string;responsibleId:string|null;client:{name:string};responsible:{name:string|null;email:string}|null};
type Operator={id:string;name:string|null;email:string};
export function ActivityTransferDialog({opened,ids,onClose,onTransferred}:{opened:boolean;ids:string[];onClose:()=>void;onTransferred:(ids:string[])=>Promise<void>}){
 const [rows,setRows]=useState<Row[]>([]),[operators,setOperators]=useState<Operator[]>([]),[responsibleId,setResponsibleId]=useState<string|null>(null),[reason,setReason]=useState("");
 const [loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(""),[stale,setStale]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!opened)return;const controller=new AbortController();
  void Promise.resolve().then(async()=>{
   if(controller.signal.aborted)return;setLoading(true);setRows([]);setOperators([]);setResponsibleId(null);setReason("");setError("");setStale(false);
   try{const response=await fetch("/api/operations/activities/transfer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"preview",activityIds:ids}),signal:controller.signal});const body=await response.json();if(!response.ok)throw Error(body.error||"Não foi possível preparar a transferência.");if(!controller.signal.aborted){setRows(body.activities);setOperators(body.operators);}}
   catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Não foi possível preparar a transferência.");}
   finally{if(!controller.signal.aborted)setLoading(false);}
  });return()=>controller.abort();
 },[opened,ids,retry]);
 const count=rows.filter(row=>row.responsibleId!==responsibleId).length;
 async function transfer(){
  setSaving(true);setError("");
  try{const response=await fetch("/api/operations/activities/transfer",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"confirm",responsibleId,reason,activities:rows.map(row=>({id:row.id,updatedAt:row.updatedAt}))})});const body=await response.json();if(!response.ok){if(response.status===409)setStale(true);throw Error(body.error||"Não foi possível transferir.");}onClose();void onTransferred(body.transferredIds).catch(()=>notifications.show({color:"yellow",message:"Transferência concluída. Atualize a lista para conferir as atividades."}));notifications.show({color:"green",title:"Transferência concluída",message:`${body.transferredIds.length} atividade(s) transferida(s).${body.unchanged?` ${body.unchanged} já estava(m) com este colaborador.`:""}`});}
  catch(e){setError(e instanceof Error?e.message:"Não foi possível transferir.");}finally{setSaving(false);}
 }
 return <Modal opened={opened} onClose={()=>!saving&&onClose()} zIndex={400} title={ids.length===1?"Transferir atividade":"Transferir atividades"} size="lg" centered closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}><Stack>
  {error&&<Alert color="red">{error}</Alert>}
  {loading?<Group><Loader size="sm"/><Text size="sm">Preparando atividades…</Text></Group>:<>
   <Select comboboxProps={{zIndex:450}} label="Transferir para" placeholder="Selecione o colaborador" searchable required data={operators.map(person=>({value:person.id,label:person.name||person.email}))} value={responsibleId} onChange={setResponsibleId} disabled={saving||stale}/>
   <ScrollArea.Autosize mah={240}><Stack gap="xs">{rows.map(row=><div key={row.id}><Text size="sm" fw={650}>{row.title}</Text><Text size="xs" c="dimmed">{row.client.name} · {row.responsible?.name||row.responsible?.email||"Sem responsável"}</Text></div>)}</Stack></ScrollArea.Autosize>
   <Textarea label="Observação (opcional)" value={reason} onChange={event=>setReason(event.currentTarget.value)} maxLength={1000} disabled={saving} autosize minRows={2}/>
   <Text size="xs" c="dimmed">Cronômetros ativos serão pausados. O tempo já apontado permanece registrado para quem executou a atividade.</Text>
   {responsibleId&&rows.length>count&&<Text size="xs" c="dimmed">{rows.length-count} atividade(s) já está(ão) com o colaborador escolhido.</Text>}
   <Group justify="flex-end"><Button variant="default" disabled={saving} onClick={onClose}>Cancelar</Button>{(stale||!rows.length)&&<Button variant="light" disabled={saving} onClick={()=>setRetry(value=>value+1)}>Atualizar seleção</Button>}<Button loading={saving} disabled={!responsibleId||!count||!rows.length||stale} onClick={()=>void transfer()}>Transferir {count} atividade(s)</Button></Group>
  </>}
 </Stack></Modal>;
}
