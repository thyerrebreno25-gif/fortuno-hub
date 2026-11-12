"use client";
import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useState } from "react";
import type { WhatsAppRoutingArea } from "./core";
type Operator={id:string;name:string|null;email:string;canAttend?:boolean};
import {DEFAULT_DEPARTMENTS,type WhatsAppDepartmentOption} from "./departments-core";
import {WhatsAppDepartmentsManager} from "./departments-manager";

export function WhatsAppTransferDialog({opened,onClose,onTransfer,operators,routingArea,departmentId,departmentName,canManageDepartments=false,saving}:{opened:boolean;onClose:()=>void;onTransfer:(data:Record<string,unknown>)=>Promise<boolean>;operators:Operator[];routingArea:WhatsAppRoutingArea;departmentId?:string|null;departmentName?:string|null;canManageDepartments?:boolean;saving:boolean}){
 const [area,setArea]=useState<string>(departmentId?"CUSTOM:"+departmentId:routingArea==="UNKNOWN"?"GENERAL":routingArea),[operatorId,setOperatorId]=useState<string|null>(null),[note,setNote]=useState("");
 const [departments,setDepartments]=useState<WhatsAppDepartmentOption[]>([]),[managing,setManaging]=useState(false),[error,setError]=useState("");
 useEffect(()=>{if(!opened||managing)return;const c=new AbortController();void fetch("/api/whatsapp/departments",{signal:c.signal,cache:"no-store"}).then(async r=>{const b=await r.json();if(!r.ok)throw new Error(b.error);if(!c.signal.aborted){setDepartments(b.items.filter((d:WhatsAppDepartmentOption)=>d.active));setError("");}}).catch(()=>{if(!c.signal.aborted)setError("Não foi possível atualizar os setores. Tente novamente.");});return()=>c.abort();},[opened,managing]);
 const options=[...DEFAULT_DEPARTMENTS,...departments.map(d=>({value:"CUSTOM:"+d.id,label:d.name}))];
 if(departmentId&&!departments.some(d=>d.id===departmentId))options.push({value:"CUSTOM:"+departmentId,label:(departmentName||"Setor anterior")+" (indisponível)"});
 const available=!area.startsWith("CUSTOM:")||departments.some(d=>"CUSTOM:"+d.id===area);
 const eligible=operators.filter(operator=>operator.canAttend),target=eligible.find(operator=>operator.id===operatorId);
 return <><Modal opened={opened} onClose={onClose} title="Transferir chamado" centered closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}><Stack gap="md">{error&&<Alert color="orange">{error}</Alert>}
  <Select label="Setor" placeholder="Selecione o tipo de atendimento" value={area} onChange={value=>{setArea((value||"GENERAL"));setOperatorId(null);}} data={options} searchable disabled={saving} allowDeselect={false} required/>
  {canManageDepartments&&<Button variant="subtle" size="compact-xs" onClick={()=>setManaging(true)}>Gerenciar setores</Button>}
  <Select label="Transferir para" placeholder="Selecione o colaborador" searchable value={operatorId} onChange={setOperatorId} data={eligible.map(operator=>({value:operator.id,label:operator.name||operator.email}))} disabled={saving} nothingFoundMessage="Nenhum colaborador disponível" required/>
  <Textarea label="Comentário interno (opcional)" placeholder="Observações para quem receberá o chamado" value={note} onChange={event=>setNote(event.currentTarget.value)} maxLength={1000} minRows={3} disabled={saving}/>
  <Text size="xs" c="dimmed">A observação fica no histórico interno. O cliente não recebe essa mensagem.</Text>
  <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={saving}>Cancelar</Button><Button color="teal" loading={saving} disabled={!target||!area||!available} onClick={async()=>{if(target&&available&&await onTransfer({action:"transfer",mode:"OPERATOR",routingArea:area.startsWith("CUSTOM:")?"GENERAL":area,...(area.startsWith("CUSTOM:")?{departmentId:area.slice(7)}:{}),assignedToId:target.id,note}))onClose();}}>Transferir</Button></Group>
 </Stack></Modal>{canManageDepartments&&<WhatsAppDepartmentsManager opened={managing} onClose={()=>setManaging(false)}/>}</>;
}
