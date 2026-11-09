"use client";
import { Button, Group, Modal, Select, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import type { WhatsAppRoutingArea } from "./core";
type Operator={id:string;name:string|null;email:string;canAttend?:boolean};
type Area=Exclude<WhatsAppRoutingArea,"UNKNOWN">;
const areas=[{value:"ACCOUNTS_PAYABLE",label:"Contas a pagar"},{value:"ACCOUNTS_RECEIVABLE",label:"Contas a receber"},{value:"GENERAL",label:"Atendimento geral"}];
export function WhatsAppTransferDialog({opened,onClose,onTransfer,operators,routingArea,saving}:{opened:boolean;onClose:()=>void;onTransfer:(data:Record<string,unknown>)=>Promise<boolean>;operators:Operator[];routingArea:WhatsAppRoutingArea;saving:boolean}){
 const [area,setArea]=useState<Area>(routingArea==="UNKNOWN"?"GENERAL":routingArea),[operatorId,setOperatorId]=useState<string|null>(null),[note,setNote]=useState("");
 const eligible=operators.filter(operator=>operator.canAttend),target=eligible.find(operator=>operator.id===operatorId);
 return <Modal opened={opened} onClose={onClose} title="Transferir chamado" centered closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}><Stack gap="md">
  <Select label="Setor" placeholder="Selecione o tipo de atendimento" value={area} onChange={value=>{setArea((value||"GENERAL") as Area);setOperatorId(null);}} data={areas} disabled={saving} allowDeselect={false} required/>
  <Select label="Transferir para" placeholder="Selecione o colaborador" searchable value={operatorId} onChange={setOperatorId} data={eligible.map(operator=>({value:operator.id,label:operator.name||operator.email}))} disabled={saving} nothingFoundMessage="Nenhum colaborador disponível" required/>
  <Textarea label="Comentário interno (opcional)" placeholder="Observações para quem receberá o chamado" value={note} onChange={event=>setNote(event.currentTarget.value)} maxLength={1000} minRows={3} disabled={saving}/>
  <Text size="xs" c="dimmed">A observação fica no histórico interno. O cliente não recebe essa mensagem.</Text>
  <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={saving}>Cancelar</Button><Button color="teal" loading={saving} disabled={!target||!area} onClick={async()=>{if(target&&await onTransfer({action:"transfer",mode:"OPERATOR",routingArea:area,assignedToId:target.id,note}))onClose();}}>Transferir</Button></Group>
 </Stack></Modal>;
}
