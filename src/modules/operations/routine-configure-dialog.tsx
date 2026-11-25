"use client";
import {useState} from "react";
import {Alert,Button,Group,Modal,MultiSelect,Select,Stack,Text} from "@mantine/core";
import {operationToday} from "./activity-deadline";
import {shiftDay} from "./analytics";
import {routinePreset,routineColumnNeedsFrequency,type RoutineClient,type RoutineColumn} from "./routine-matrix";
import {routineScheduleLabel} from "./routine-schedule";
import {reconciliation,routinePriority} from "./routine-policy";
import type {RoutineEdit} from "./edit-model";
type Member={id:string;name:string|null;email:string};
export function RoutineConfigureDialog({client,column,members,onClose,onChanged}:{client:RoutineClient;column:RoutineColumn;members:Member[];teams:string[];onClose:()=>void;onChanged:()=>Promise<void>}){
 const [responsibleId,setResponsibleId]=useState<string|null>(null),[frequency,setFrequency]=useState<string|null>(null),[monthDays,setMonthDays]=useState<string[]>([]);
 const [processId,setProcessId]=useState(column.processId||""),[resume,setResume]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const needsFrequency=routineColumnNeedsFrequency(column),custom=column.kind==="customAgenda",preset=routinePreset(column,shiftDay(operationToday(),1));
 if(frequency){preset.recurrenceType=(frequency==="FORTNIGHTLY"?"DAILY":frequency) as RoutineEdit["recurrenceType"];preset.recurrenceData.interval=frequency==="FORTNIGHTLY"?15:1;preset.recurrenceData.dailyMode=frequency==="FORTNIGHTLY"?"ALL_DAYS":"BUSINESS_DAYS";if(frequency==="MONTHLY")preset.recurrenceData.monthDays=[Number(preset.recurrenceData.startDate.slice(-2))];}
 if(custom)preset.recurrenceData.monthDays=monthDays.map(Number);
 async function save(){
  if(!responsibleId||needsFrequency&&!frequency||custom&&!monthDays.length)return;setBusy(true);setError("");
  try{let id=processId;if(!id){const response=await fetch("/api/operations/processes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:column.processName,department:"Operação",notifyClient:column.notifyClient===true})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível preparar a rotina.");id=body.process.id;setProcessId(id);}
   const response=await fetch("/api/operations/configurations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...preset,responsibleId,clientId:client.id,processId:id,priority:routinePriority(column.processName),notifyClient:!reconciliation(column.processName)&&column.notifyClient===true,resumeConfigurationId:resume||undefined})});const body=await response.json();if(!response.ok){if(body.configurationId)setResume(body.configurationId);throw new Error(body.error||"Não foi possível marcar a rotina.");}await onChanged();onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível marcar a rotina.");}finally{setBusy(false);}
 }
 return <Modal opened onClose={()=>{if(!busy){void onChanged();onClose();}}} title="Marcar rotina" centered size="sm" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack gap="sm">
  <div><Text fw={700} size="sm">{client.name}</Text><Text c="dimmed" size="sm">{column.label}</Text></div>{error&&<Alert color="red">{error}</Alert>}
  <Select required label="Responsável" searchable data={members.map(m=>({value:m.id,label:m.name||m.email}))} value={responsibleId} onChange={setResponsibleId} disabled={busy||Boolean(resume)}/>
  {needsFrequency&&<Select required label="Recorrência" placeholder="Selecione a frequência" data={[{value:"DAILY",label:"Diária"},{value:"WEEKLY",label:"Semanal"},{value:"FORTNIGHTLY",label:"Quinzenal"},{value:"MONTHLY",label:"Mensal"}]} value={frequency} onChange={setFrequency} disabled={busy||Boolean(resume)}/>}
  {custom&&<MultiSelect required label="Dias específicos do mês" data={Array.from({length:31},(_,i)=>({value:String(i+1),label:`Dia ${i+1}`}))} value={monthDays} onChange={setMonthDays} disabled={busy||Boolean(resume)}/>}
  {(!needsFrequency||frequency)&&(!custom||monthDays.length>0)&&<Text size="sm" c="dimmed">{routineScheduleLabel(preset.recurrenceType,preset.recurrenceData)}{column.kind==="agenda"?" · Prioridade alta":""}</Text>}
  {client.team&&<Text size="sm" c="dimmed">Equipe: {client.team}</Text>}
  <Text size="xs" c="dimmed">Somente dias úteis. Fins de semana e feriados são antecipados para o dia útil anterior. A agenda de 90 dias será gerada ao confirmar.</Text>
  <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>{void onChanged();onClose();}}>Cancelar</Button><Button loading={busy} disabled={!responsibleId||needsFrequency&&!frequency||custom&&!monthDays.length} onClick={()=>void save()}>{resume?"Retomar":"Confirmar"}</Button></Group>
 </Stack></Modal>;
}
