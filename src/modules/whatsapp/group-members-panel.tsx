"use client";
import {useState} from "react";
import {ActionIcon,Alert,Avatar,Badge,Button,Group,Menu,Modal,Pagination,Paper,Stack,Text,TextInput} from "@mantine/core";
import {IconDotsVertical,IconRefresh,IconSearch,IconUserMinus,IconUserPlus} from "@tabler/icons-react";
import {notifications} from "@mantine/notifications";
import {FilterPanel} from "@/components/filter-panel";
import {canRemoveGroupMember} from "./group-management-policy";
import {AddGroupParticipant} from "./add-group-participant";
import type {GroupMember} from "./group-members";
const fold=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
export function GroupMembersPanel({ticketId,groupJid,groupName,members,available,total,management,ownerId,refreshing,onChanged}:{ticketId:string;groupJid:string;groupName:string;members:GroupMember[];available:boolean;total:number|null;management?:{canSaveContact?:boolean;allowed:boolean;phone:string;reason:string|null}|null;ownerId:string|null;refreshing:boolean;onChanged:()=>void}){
 const [query,setQuery]=useState(""),[page,setPage]=useState(1);
 const [removing,setRemoving]=useState<GroupMember|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [requestId,setRequestId]=useState("");
 const [naming,setNaming]=useState<GroupMember|null>(null),[contactName,setContactName]=useState("");
 async function saveName(){if(!naming?.phone)return;setBusy(true);setError("");try{const response=await fetch("/api/whatsapp/contacts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({number:naming.phone,name:contactName.trim()})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível salvar o contato.");setNaming(null);onChanged();notifications.show({color:"green",message:"Nome salvo na agenda do WhatsApp."});}catch(error){setError(error instanceof Error?error.message:"Não foi possível salvar o nome.");}finally{setBusy(false);}}
 const needle=fold(query.trim()),filtered=members.filter(member=>fold([member.name,member.phone,member.lid].filter(Boolean).join(" ")).includes(needle)).sort((a,b)=>Number(b.isSuperAdmin)-Number(a.isSuperAdmin)||Number(b.isAdmin)-Number(a.isAdmin)||(a.name||a.phone||a.id).localeCompare(b.name||b.phone||b.id,"pt-BR"));
 const pageCount=Math.max(1,Math.ceil(filtered.length/40)),currentPage=Math.min(page,pageCount),visible=filtered.slice((currentPage-1)*40,currentPage*40);
 const close=()=>{if(!busy){setRemoving(null);setError("");}};
 async function submit(){
  setBusy(true);setError("");
  try{
   const response=await fetch(`/api/whatsapp/${encodeURIComponent(ticketId)}/participants`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"remove",participant:removing?.id,requestId})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Não foi possível confirmar a alteração.");
   setRemoving(null);onChanged();notifications.show({color:"green",message:result.message});
  }catch(error){setError(error instanceof Error?error.message:"Não foi possível confirmar a alteração.");onChanged();}
  finally{setBusy(false);}
 }
 return <Stack gap="sm">
  <Group justify="space-between"><Text size="sm" c="dimmed">{members.length} membro(s) identificado(s){total!==null?` de ${total}`:""}</Text><Group gap="xs"><ActionIcon aria-label="Atualizar membros" title="Atualizar membros" variant="subtle" loading={refreshing} disabled={busy} onClick={onChanged}><IconRefresh size={17}/></ActionIcon><AddGroupParticipant allowed={Boolean(management?.allowed)} ticketId={ticketId} groupJid={groupJid} groupName={groupName} disabled={busy||refreshing} onChanged={onChanged}/></Group></Group>
  {management?.reason&&<Text size="xs" c="dimmed">{management.reason}</Text>}
  {members.length>10&&<FilterPanel title="Buscar membros" activeCount={query?1:0}><TextInput aria-label="Buscar membro" placeholder="Nome ou telefone" leftSection={<IconSearch size={16}/>} value={query} onChange={event=>{setQuery(event.currentTarget.value);setPage(1);}} maxLength={150}/></FilterPanel>}
  {visible.map(member=><Paper key={member.id} withBorder radius="md" p="sm"><Group wrap="nowrap" align="center" gap="sm"><Avatar src={member.photo} alt={member.name||"Membro do grupo"} radius="xl" size={40} color="blue">{member.name?member.name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase():"?"}</Avatar><div style={{minWidth:0,flex:1}}><Text size="sm" fw={650} style={{overflowWrap:"anywhere"}}>{member.name||"Nome não disponível"}</Text><Text size="xs" c="dimmed" style={{overflowWrap:"anywhere"}}>{member.phone?`+${member.phone}`:"Telefone não disponibilizado pelo WhatsApp"}</Text></div>{(member.isAdmin||member.isSuperAdmin)&&<Badge variant="light" color="teal" size="xs" style={{flexShrink:0}}>Administrador</Badge>}{((management?.allowed&&canRemoveGroupMember(member,management.phone,ownerId))||(management?.canSaveContact&&!member.name&&member.phone))&&<Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon aria-label={`Opções de ${member.name||member.phone||"participante"}`} variant="subtle" color="gray" disabled={busy||refreshing}><IconDotsVertical size={18}/></ActionIcon></Menu.Target><Menu.Dropdown>{management?.canSaveContact&&!member.name&&member.phone&&<Menu.Item leftSection={<IconUserPlus size={15}/>} onClick={()=>{setNaming(member);setContactName("");setError("");}}>Salvar nome do contato</Menu.Item>}{management?.allowed&&canRemoveGroupMember(member,management.phone,ownerId)&&<Menu.Item color="red" leftSection={<IconUserMinus size={15}/>} onClick={()=>{setError("");setRequestId(crypto.randomUUID());setRemoving(member);}}>Remover do grupo</Menu.Item>}</Menu.Dropdown></Menu>}</Group></Paper>)}
  {!visible.length&&<Text size="sm" c="dimmed" py="md">{needle?"Nenhum membro corresponde à busca.":available?"O WhatsApp não retornou participantes identificáveis para este grupo.":"A lista de membros não foi disponibilizada pelo WhatsApp. Tente abrir novamente em instantes."}</Text>}
  {pageCount>1&&<Group justify="center"><Pagination total={pageCount} value={currentPage} onChange={setPage}/></Group>}
  <Modal opened={Boolean(naming)} onClose={()=>!busy&&setNaming(null)} title="Salvar nome do contato" centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack><Text size="sm">+{naming?.phone}</Text><TextInput label="Nome" value={contactName} onChange={event=>setContactName(event.currentTarget.value)} maxLength={150} disabled={busy}/>{error&&<Alert color="red">{error}</Alert>}<Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>setNaming(null)}>Cancelar</Button><Button loading={busy} disabled={!contactName.trim()} onClick={()=>void saveName()}>Salvar na agenda</Button></Group></Stack></Modal>
  <Modal opened={Boolean(removing)} onClose={close} title="Remover participante" centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack>
   <Text>Remover {removing?.name||removing?.phone||"este participante"} deste grupo no WhatsApp?</Text>
   {error&&<Alert color="red">{error}</Alert>}
   <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={close}>Cancelar</Button><Button color="red" loading={busy} disabled={refreshing||Boolean(error)} onClick={()=>void submit()}>Remover do grupo</Button></Group>
   {error&&<Text size="xs" c="dimmed">A lista está sendo atualizada. Feche esta janela e confira os membros antes de iniciar uma nova tentativa.</Text>}
  </Stack></Modal>
 </Stack>;
}
