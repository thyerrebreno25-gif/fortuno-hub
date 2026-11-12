"use client";
import {useState} from "react";
import {Avatar,Badge,Group,Pagination,Paper,Stack,Text,TextInput} from "@mantine/core";
import {IconSearch} from "@tabler/icons-react";
import {FilterPanel} from "@/components/filter-panel";
import type {GroupMember} from "./group-members";
const fold=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");
export function GroupMembersPanel({members,available,total}:{members:GroupMember[];available:boolean;total:number|null}){
 const [query,setQuery]=useState(""),[page,setPage]=useState(1);
 const needle=fold(query.trim()),filtered=members.filter(member=>fold([member.name,member.phone,member.lid].filter(Boolean).join(" ")).includes(needle)).sort((a,b)=>Number(b.isSuperAdmin)-Number(a.isSuperAdmin)||Number(b.isAdmin)-Number(a.isAdmin)||(a.name||a.phone||a.id).localeCompare(b.name||b.phone||b.id,"pt-BR"));
 const pageCount=Math.max(1,Math.ceil(filtered.length/40)),currentPage=Math.min(page,pageCount),visible=filtered.slice((currentPage-1)*40,currentPage*40);
 return <Stack gap="sm"><Text size="sm" c="dimmed">{members.length} membro(s) identificado(s){total!==null?` de ${total}`:""}</Text>
  {members.length>10&&<FilterPanel title="Buscar membros" activeCount={query?1:0}><TextInput aria-label="Buscar membro" placeholder="Nome ou telefone" leftSection={<IconSearch size={16}/>} value={query} onChange={event=>{setQuery(event.currentTarget.value);setPage(1);}} maxLength={150}/></FilterPanel>}
  {visible.map(member=><Paper key={member.id} withBorder radius="md" p="sm"><Group wrap="nowrap" align="center" gap="sm"><Avatar src={member.photo} alt={member.name||"Membro do grupo"} radius="xl" size={40} color="blue">{member.name?member.name.split(/\s+/).slice(0,2).map(part=>part[0]).join("").toUpperCase():"?"}</Avatar><div style={{minWidth:0,flex:1}}><Text size="sm" fw={650} style={{overflowWrap:"anywhere"}}>{member.name||"Nome não disponível"}</Text><Text size="xs" c="dimmed" style={{overflowWrap:"anywhere"}}>{member.phone?`+${member.phone}`:"Telefone não disponibilizado pelo WhatsApp"}</Text></div>{(member.isAdmin||member.isSuperAdmin)&&<Badge variant="light" color="teal" size="xs" style={{flexShrink:0}}>Administrador</Badge>}</Group></Paper>)}
  {!visible.length&&<Text size="sm" c="dimmed" py="md">{needle?"Nenhum membro corresponde à busca.":available?"O WhatsApp não retornou participantes identificáveis para este grupo.":"A lista de membros não foi disponibilizada pelo WhatsApp. Tente abrir novamente em instantes."}</Text>}
  {pageCount>1&&<Group justify="center"><Pagination total={pageCount} value={currentPage} onChange={setPage}/></Group>}
 </Stack>;
}
