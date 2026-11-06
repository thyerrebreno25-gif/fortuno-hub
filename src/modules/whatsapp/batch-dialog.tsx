"use client";
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Pagination, Paper, Progress, ScrollArea, Stack, Text, Textarea, TextInput } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
type Recipient={id:string;senderName:string|null;subject:string;senderEmail:string;client:{name:string}|null};
type Delivery={id:string;recipientName:string;status:string;error:string|null;body:string};
const labels:Record<string,string>={PENDING:"Pendente",SENDING:"Envio iniciado · confirmação pendente",SENT:"Aceita pelo WhatsApp",UNKNOWN:"Não confirmado · conferir conversa",CANCELLED:"Cancelado"};
export function WhatsAppBatchDialog({opened,onClose,content,scope,onSent}:{opened:boolean;onClose:()=>void;content:string;scope:string;onSent:()=>void}) {
  const [message,setMessage]=useState(content),[search,setSearch]=useState(""),[page,setPage]=useState(1),[items,setItems]=useState<Recipient[]>([]),[total,setTotal]=useState(0),[selected,setSelected]=useState<Map<string,Recipient>>(new Map()),[review,setReview]=useState(false),[deliveries,setDeliveries]=useState<Delivery[]>([]),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const batchId=useRef<string|null>(null),stop=useRef(false),storageKey="fortuno-whatsapp-batch:"+scope;
  useEffect(()=>{if(!opened)return;const controller=new AbortController();const timer=setTimeout(async()=>{setLoading(true);try{const r=await fetch('/api/whatsapp/batch?'+new URLSearchParams({search,page:String(page)}),{signal:controller.signal,cache:'no-store'});const b=await r.json();if(!r.ok)throw new Error(b.error);if(!controller.signal.aborted){setItems(b.items);setTotal(b.total);}}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Falha ao carregar as conversas.');}finally{if(!controller.signal.aborted)setLoading(false);}},250);return()=>{controller.abort();clearTimeout(timer);};},[opened,search,page]);
  useEffect(()=>{if(!opened)return;let active=true;let saved:string|null=null;try{saved=localStorage.getItem(storageKey);}catch{}if(saved&&!batchId.current)void fetch('/api/whatsapp/batch?batchId='+encodeURIComponent(saved),{cache:'no-store'}).then(async r=>{if(!r.ok)return;const b=await r.json();if(active&&b.deliveries?.length){batchId.current=saved;setDeliveries(b.deliveries);setReview(true);setMessage(b.deliveries[0].body);}}).catch(()=>{});return()=>{active=false;};},[opened,storageKey]);
  async function run() {
    if(busy)return;setBusy(true);stop.current=false;setError("");
    try {
      let rows=deliveries;
      if(!rows.length){batchId.current ||= crypto.randomUUID();const r=await fetch('/api/whatsapp/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',batchId:batchId.current,content:message,ticketIds:[...selected.keys()]})});const b=await r.json();if(!r.ok)throw new Error(b.error);rows=b.deliveries;setDeliveries(rows);try{localStorage.setItem(storageKey,batchId.current!);}catch{}}
      for(const item of rows.filter(d=>d.status==='PENDING')) {
        if(stop.current)break;
        const r=await fetch('/api/whatsapp/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deliver',deliveryId:item.id})});const b=await r.json();if(!r.ok)throw new Error(b.error);
        rows=rows.map(d=>d.id===item.id?{...d,status:b.status,error:b.error||null}:d);setDeliveries(rows);
        if(b.status==='UNKNOWN'||b.status==='SENDING'){setError('Lote pausado: confira o envio sem confirmação antes de continuar com os demais destinatários.');break;}
      }
      onSent();
    }catch(e){setError(e instanceof Error?e.message:'O lote foi pausado. Consulte os resultados antes de continuar.');if(batchId.current)try{const r=await fetch('/api/whatsapp/batch?batchId='+batchId.current,{cache:'no-store'});if(r.ok){const recovered=(await r.json()).deliveries;setDeliveries(recovered);if(recovered?.length)setMessage(recovered[0].body);}}catch{}}
    finally{setBusy(false);}
  }
  const reset=()=>{setDeliveries([]);setSelected(new Map());setReview(false);setMessage(content);setError("");batchId.current=null;try{localStorage.removeItem(storageKey);}catch{}};
  const pending=deliveries.filter(d=>d.status==='PENDING').length,done=deliveries.filter(d=>d.status==='SENT').length;
  return <Modal opened={opened} onClose={onClose} title="Enviar mensagem padrão em lote" size="lg" centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack gap="md">
    {error&&<Alert color="orange">{error}</Alert>}
    <Textarea label="Mensagem para os destinatários" value={message} onChange={e=>setMessage(e.currentTarget.value)} minRows={3} maxRows={7} autosize maxLength={5000} disabled={busy||deliveries.length>0}/>
    {!review?<><TextInput label="Selecionar conversas" placeholder="Buscar contato, grupo ou cliente" value={search} onChange={e=>{setSearch(e.currentTarget.value);setPage(1);}}/><Group justify="space-between"><Text size="sm">{selected.size}/50 selecionadas</Text><Button size="compact-xs" variant="subtle" onClick={()=>setSelected(new Map())}>Limpar seleção</Button></Group><ScrollArea h={280}>{loading?<Loader size="sm"/>:items.map(item=><Paper key={item.id} withBorder p="sm" mb={6}><Checkbox label={item.senderName||item.subject} description={(item.client?.name||"Sem cliente")+" · "+(item.senderEmail.startsWith('wa-group:')?'Grupo':item.senderEmail.replace('wa-contact:','+'))} checked={selected.has(item.id)} disabled={!selected.has(item.id)&&selected.size>=50} onChange={e=>{const checked=e.currentTarget.checked;setSelected(previous=>{const next=new Map(previous);if(checked)next.set(item.id,item);else next.delete(item.id);return next;});}}/></Paper>)}{!loading&&!items.length&&<Text size="sm" c="dimmed">Nenhuma conversa aberta disponível.</Text>}</ScrollArea><Pagination total={Math.max(1,Math.ceil(total/50))} value={page} onChange={setPage}/><Text size="xs" c="dimmed">Disponíveis os chamados abertos que você pode atender. Gestores podem selecionar toda a equipe.</Text><Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancelar</Button><Button disabled={!selected.size||!message.trim()} onClick={()=>setReview(true)}>Revisar destinatários ({selected.size})</Button></Group></>:<>
      <Text fw={750}>{deliveries.length?`${done} de ${deliveries.length} envios aceitos`:`Revisão · ${selected.size} destinatários`}</Text>
      {deliveries.length>0&&<Progress value={done/deliveries.length*100} color="teal"/>}
      <ScrollArea h={260}>{deliveries.length?deliveries.map(d=><Paper withBorder p="sm" mb={6} key={d.id}><Group justify="space-between"><Text fw={650} size="sm">{d.recipientName}</Text><Badge color={d.status==='SENT'?'teal':d.status==='PENDING'?'gray':'orange'}>{labels[d.status]||d.status}</Badge></Group>{d.error&&<Text size="xs" c="orange" mt={4}>{d.error}</Text>}</Paper>):[...selected.values()].map(r=><Paper withBorder p="sm" mb={6} key={r.id}><Text fw={650} size="sm">{r.senderName||r.subject}</Text><Text size="xs" c="dimmed">{r.client?.name||'Sem cliente vinculado'}</Text></Paper>)}</ScrollArea>
      <Text size="xs" c="dimmed">O nome do operador acompanha cada envio. “Aceita pelo WhatsApp” confirma o recebimento pela API; a entrega aparece na conversa.</Text>
      <Group justify="flex-end">{busy?<Button variant="default" onClick={()=>{stop.current=true;}}>Pausar após este envio</Button>:<><Button variant="default" onClick={onClose}>Fechar</Button>{!deliveries.length?<Button variant="subtle" onClick={()=>setReview(false)}>Voltar à seleção</Button>:<Button variant="subtle" disabled={pending>0} onClick={reset}>Novo lote</Button>}</>}{(!deliveries.length||pending>0)&&<Button color="teal" loading={busy} disabled={!message.trim()} onClick={run}>{deliveries.length?`Continuar pendentes (${pending})`:`Enviar para ${selected.size} destinatários`}</Button>}</Group>
    </>}
  </Stack></Modal>;
}
