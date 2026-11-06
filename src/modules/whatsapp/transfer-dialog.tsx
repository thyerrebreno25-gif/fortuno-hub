"use client";
import { Alert, Button, Group, Modal, Select, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { responsibleForTransfer, type WhatsAppRoutingArea, type WhatsAppRoutingClient } from "./core";
export type TransferClient = WhatsAppRoutingClient & { id: string; name: string; document: string | null };
type Operator = { id: string; name: string | null; email: string; canAttend?: boolean };
const areas = [{value:"ACCOUNTS_PAYABLE",label:"Contas a pagar"},{value:"ACCOUNTS_RECEIVABLE",label:"Contas a receber"},{value:"GENERAL",label:"Atendimento geral"}];
export function WhatsAppTransferDialog({opened,onClose,onTransfer,clients,operators,clientId,routingArea,saving}:{opened:boolean;onClose:()=>void;onTransfer:(data:Record<string,unknown>)=>Promise<boolean>;clients:TransferClient[];operators:Operator[];clientId:string|null;routingArea:WhatsAppRoutingArea;saving:boolean}) {
  const [selectedClient,setSelectedClient]=useState<string|null>(clientId),[destination,setDestination]=useState<string|null>("area:"+(routingArea==="UNKNOWN"?"GENERAL":routingArea)),[area,setArea]=useState(routingArea==="UNKNOWN"?"GENERAL":routingArea),[note,setNote]=useState("");
  const mode=destination?.startsWith("area:")?"AREA":"OPERATOR",selectedArea=mode==="AREA"?destination?.slice(5):area;
  const client=clients.find(c=>c.id===selectedClient),eligible=operators.filter(o=>o.canAttend);
  const targetId=mode==="AREA"&&client?responsibleForTransfer(client,selectedArea as WhatsAppRoutingArea):destination?.slice(5);
  const target=eligible.find(o=>o.id===targetId);
  return <Modal opened={opened} onClose={onClose} title="Transferir chamado" centered closeOnClickOutside={!saving} closeOnEscape={!saving} withCloseButton={!saving}><Stack gap="md">
    <Select label="Transferir para" placeholder="Selecione o setor ou colaborador" searchable value={destination} onChange={setDestination} disabled={saving} data={[{group:"Setor · responsável do cliente",items:areas.map(a=>({value:"area:"+a.value,label:a.label}))},{group:"Colaboradores",items:eligible.map(o=>({value:"user:"+o.id,label:o.name||o.email}))}]}/>
    <Select label="Cliente" placeholder="Selecione o cliente" searchable value={selectedClient} onChange={setSelectedClient} disabled={saving} data={clients.map(c=>({value:c.id,label:c.name}))}/>
    {mode==="OPERATOR"&&<Select label="Setor do chamado" value={area} onChange={v=>setArea((v||"GENERAL") as typeof area)} data={areas} disabled={saving}/>}
    {target?<Text size="sm" c="teal">Destino: <strong>{target.name||target.email}</strong> · {areas.find(a=>a.value===selectedArea)?.label}</Text>:mode==="AREA"&&selectedClient?<Alert color="orange">O cliente não possui um responsável disponível neste setor. Confira o cadastro ou selecione um colaborador em “Transferir para”.</Alert>:null}
    <Textarea label="Comentário interno (opcional)" placeholder="Observações para quem receberá o chamado" value={note} onChange={e=>setNote(e.currentTarget.value)} maxLength={1000} minRows={3} disabled={saving}/>
    <Text size="xs" c="dimmed">A observação fica no histórico interno. O cliente não recebe essa mensagem.</Text>
    <Group justify="flex-end"><Button variant="default" onClick={onClose} disabled={saving}>Cancelar</Button><Button color="teal" loading={saving} disabled={!target} onClick={async()=>{if(await onTransfer({action:"transfer",mode,...(selectedClient?{clientId:selectedClient}:{}),routingArea:selectedArea,...(mode==="OPERATOR"?{assignedToId:targetId}:{}),note}))onClose();}}>Transferir</Button></Group>
  </Stack></Modal>;
}
