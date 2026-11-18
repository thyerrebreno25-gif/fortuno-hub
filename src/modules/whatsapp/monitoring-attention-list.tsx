"use client";
import {ActionIcon,Alert,Badge,Button,Checkbox,Group,Menu,Modal,Stack,Text,Tooltip} from "@mantine/core";
import {notifications} from "@mantine/notifications";
import {IconDots,IconExternalLink,IconRefresh} from "@tabler/icons-react";
import {useState} from "react";
import {ConversationPreviewCard} from "./conversation-preview-card";
import {WhatsAppFinalizeDialog} from "./finalize-dialog";
import type {MonitoringData} from "./monitoring-types";
import styles from "./monitoring-attention.module.css";
const duration=(minutes:number)=>minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h${minutes%60?` ${minutes%60}min`:""}`;
const dateTime=(value:string)=>new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(value));
const statuses:Record<string,string>={NEW:"Na fila",IN_PROGRESS:"Em atendimento",WAITING_CUSTOMER:"Aguardando cliente",WAITING_INTERNAL:"Aguardando resposta"};
export function MonitoringQueue({data}:{data:MonitoringData}){
 const queue=data.insights?.currentQueue;
 return <div className={styles.queue}><Text fw={800}>Fila de atendimento</Text><Text size="xs" c="dimmed">Conversas sem responsável agora · tempos de espera em tempo corrido</Text><div className={styles.queueGrid}>
  {[{label:"Aguardando atendimento",value:String(queue?.count??data.summary.queue)},{label:"Espera média",value:duration(queue?.averageMinutes??0)},{label:"Maior espera",value:duration(queue?.longestMinutes??0)},{label:"Acima de 15 minutos",value:String(queue?.overSla??0)}].map(item=><div key={item.label}><Text size="xs" c="dimmed">{item.label}</Text><div className={styles.queueValue}>{item.value}</div></div>)}
 </div></div>;
}
export function MonitoringAttentionList({data,canEdit,onOpenTicket,onClosed,onReset}:{data:MonitoringData;canEdit:boolean;onOpenTicket:(id:string)=>void;onClosed:(ids:string[])=>void;onReset:()=>void}){
 const [selected,setSelected]=useState<string[]>([]),[previewId,setPreviewId]=useState<string|null>(null),[pendingIds,setPendingIds]=useState<string[]>([]),[openRequest,setOpenRequest]=useState(0);
 const [resetOpened,setResetOpened]=useState(false),[requestId,setRequestId]=useState(""),[resetting,setResetting]=useState(false),[error,setError]=useState("");
 const visibleIds=data.attention.map(item=>item.id),selection=selected.filter(id=>visibleIds.includes(id));
 function finalize(ids:string[]){setPreviewId(null);setPendingIds(ids);setOpenRequest(value=>value+1);}
 async function reset(){
  setResetting(true);setError("");
  try{
   const response=await fetch("/api/whatsapp/monitoring/reset-attention",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountRecipient:data.accountRecipient,requestId})});
   const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível reiniciar os tempos.");
   setResetOpened(false);setSelected([]);onReset();notifications.show({color:"green",message:"Tempos de atenção reiniciados. Conversas e histórico preservados."});
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível reiniciar os tempos.");}finally{setResetting(false);}
 }
 return <>
 <section className={styles.card}>
  <div className={styles.heading}><div><Text fw={850}>Atendimentos que precisam de atenção</Text><Text size="xs" c="dimmed">Passe o mouse sobre o contato para ver a conversa. Chamados abertos, inclusive de outros períodos.</Text>{data.attentionStartedAt&&<Text size="xs" c="dimmed">Tempos reiniciados em {dateTime(data.attentionStartedAt)} · histórico preservado</Text>}</div>
   <Group gap="xs"><Badge variant="light" color={data.summary.longestCurrentWaitMinutes>60?"red":"blue"}>Maior espera: {duration(data.summary.longestCurrentWaitMinutes)}</Badge>{canEdit&&<Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon variant="subtle" aria-label="Opções dos tempos de atenção"><IconDots size={18}/></ActionIcon></Menu.Target><Menu.Dropdown><Menu.Item leftSection={<IconRefresh size={15}/>} disabled={!data.accountRecipient} onClick={()=>{setRequestId(crypto.randomUUID());setError("");setResetOpened(true);}}>Zerar tempos de atenção</Menu.Item></Menu.Dropdown></Menu>}</Group>
  </div>
  {canEdit&&selection.length>0&&<Group className={styles.toolbar} justify="space-between"><Text size="sm">{selection.length} selecionado(s)</Text><Group gap="xs"><Button size="compact-xs" variant="subtle" onClick={()=>setSelected([])}>Limpar seleção</Button><Button size="compact-sm" color="green" onClick={()=>finalize(selection)}>Finalizar selecionados ({selection.length})</Button></Group></Group>}
  <div className={styles.scroll} role="region" aria-label="Atendimentos que precisam de atenção" tabIndex={0}><table className={styles.table}><thead><tr>{canEdit&&<th><Checkbox aria-label="Selecionar todos os atendimentos visíveis" checked={visibleIds.length>0&&selection.length===visibleIds.length} indeterminate={selection.length>0&&selection.length<visibleIds.length} onChange={event=>setSelected(event.currentTarget.checked?visibleIds:[])}/></th>}<th>Conversa / cliente</th><th>Responsável</th><th>Situação</th><th>Espera / atenção</th><th>Ações</th></tr></thead><tbody>
  {data.attention.map(item=>{const risk=data.insights?.risks.find(row=>row.id===item.id);return <tr key={item.id}>
   {canEdit&&<td><Checkbox aria-label={`Selecionar ${item.contact}`} checked={selection.includes(item.id)} onChange={event=>{const checked=event.currentTarget.checked;setSelected(current=>checked?[...current.filter(id=>id!==item.id),item.id]:current.filter(id=>id!==item.id));}}/></td>}
   <td><ConversationPreviewCard id={item.id} name={item.contact} version={item.lastMessageAt} opened={previewId===item.id} onChange={open=>setPreviewId(current=>open?item.id:current===item.id?null:current)} onOpen={()=>onOpenTicket(item.id)}/><span className={styles.muted} title={item.client}>{item.client}</span></td>
   <td>{item.assignee}</td><td><Badge size="xs" variant="light" color={item.status==="NEW"?"orange":"blue"}>{statuses[item.status]||item.status}</Badge><span className={styles.muted}>Última: {dateTime(item.lastMessageAt)}</span></td>
   <td><Badge color={risk?.severity==="CRITICAL"?"red":"orange"} variant="light">{duration(item.waitingMinutes)}</Badge>{Boolean(risk?.reasons.length)&&<Tooltip label={risk?.reasons.join(" · ")} multiline w={260}><div className={styles.reason}>{risk?.reasons[0]}{(risk?.reasons.length||0)>1?` · +${risk!.reasons.length-1}`:""}</div></Tooltip>}</td>
   <td><Group gap={6} wrap="nowrap">{canEdit&&<Button size="compact-xs" variant="light" color="green" onClick={()=>finalize([item.id])}>Finalizar</Button>}<Tooltip label="Abrir conversa"><ActionIcon variant="subtle" aria-label={`Abrir conversa de ${item.contact}`} onClick={()=>onOpenTicket(item.id)}><IconExternalLink size={16}/></ActionIcon></Tooltip></Group></td>
  </tr>;})}
  {!data.attention.length&&<tr><td colSpan={canEdit?6:5} className={styles.empty}>Nenhum atendimento precisa de atenção neste momento.</td></tr>}
  </tbody></table></div>
  {data.attention.length>=50&&<Text p="xs" size="xs" c="dimmed">Exibindo os 50 atendimentos prioritários. A seleção abrange os itens visíveis.</Text>}
 </section>
 {canEdit&&<WhatsAppFinalizeDialog hideTrigger openRequest={openRequest} ticketIds={pendingIds} onClosed={ids=>{setSelected(current=>current.filter(id=>!ids.includes(id)));onClosed(ids);}}/>}
 <Modal opened={resetOpened} onClose={()=>!resetting&&setResetOpened(false)} title="Zerar tempos de atenção" centered closeOnClickOutside={!resetting} closeOnEscape={!resetting} withCloseButton={!resetting}><Stack>{error&&<Alert color="red">{error}</Alert>}<Text size="sm">Reiniciar a contagem de espera, tempo em aberto e alertas acumulados dos atendimentos desta conexão a partir de agora?</Text><Text size="sm" c="dimmed">As conversas continuam abertas e o histórico é preservado. Novas mensagens e esperas voltarão a gerar alertas normalmente.</Text><Group justify="flex-end"><Button variant="default" disabled={resetting} onClick={()=>setResetOpened(false)}>Cancelar</Button><Button onClick={()=>void reset()} loading={resetting}>Zerar tempos de atenção</Button></Group></Stack></Modal>
 </>;
}
