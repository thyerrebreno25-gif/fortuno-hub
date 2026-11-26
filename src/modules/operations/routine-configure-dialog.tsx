"use client";
import {useEffect,useRef,useState} from "react";
import {Alert,Button,Group,Modal,MultiSelect,Select,Stack,Text,TextInput} from "@mantine/core";
import {inheritedRoutineFamily} from "./routine-ownership";
import {operationDayRange,operationToday} from "./activity-deadline";
import {shiftDay} from "./analytics";
import {routinePreset,routineFixedFrequency,routineColumnNeedsFrequency,type RoutineClient,type RoutineColumn,type RoutineFrequency} from "./routine-matrix";
import {routineScheduleLabel} from "./routine-schedule";
import {reconciliation,routinePriority} from "./routine-policy";
type Member={id:string;name:string|null;email:string};
export function RoutineConfigureDialog({client,column,members,inheritedResponsibleId,onClose,onChanged}:{client:RoutineClient;column:RoutineColumn;members:Member[];inheritedResponsibleId?:string|null;teams:string[];onClose:()=>void;onChanged:()=>Promise<void>}){
 const [responsibleId,setResponsibleId]=useState<string|null>(inheritedResponsibleId||null),[frequency,setFrequency]=useState<RoutineFrequency|null>(null),[monthDays,setMonthDays]=useState<string[]>([]),[startDate,setStartDate]=useState("");
 const [processId,setProcessId]=useState(column.processId||""),[resume,setResume]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const needsFrequency=routineColumnNeedsFrequency(column),custom=column.kind==="customAgenda",cadence=routineFixedFrequency(column)||frequency;
 const needsStart=custom||cadence==="MONTHLY"||cadence==="FORTNIGHTLY";
 let validStart=false;try{operationDayRange(startDate);validStart=true;}catch{}
 const preset=routinePreset(column,needsStart&&validStart?startDate:shiftDay(operationToday(),1),frequency);
 if(custom)preset.recurrenceData.monthDays=monthDays.map(Number);
 const inherited=inheritedRoutineFamily(column.processName);
 const auto=Boolean(inheritedResponsibleId)&&!needsFrequency&&!custom&&!needsStart;
 const automaticStarted=useRef(false);
 const saveRef=useRef<()=>Promise<void>>(async()=>{});
 useEffect(()=>{if(!auto)return;const timer=setTimeout(()=>{if(!automaticStarted.current){automaticStarted.current=true;void saveRef.current();}},0);return()=>clearTimeout(timer);},[auto]);
 async function save(){
  if(inherited&&!inheritedResponsibleId||!responsibleId||needsFrequency&&!frequency||custom&&!monthDays.length||needsStart&&!validStart)return;setBusy(true);setError("");
  try{let id=processId;if(!id){const response=await fetch("/api/operations/processes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:column.processName,department:"Operação",notifyClient:column.notifyClient===true})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível preparar a rotina.");id=body.process.id;setProcessId(id);}
   const response=await fetch("/api/operations/configurations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...preset,responsibleId,clientId:client.id,processId:id,priority:routinePriority(column.processName),notifyClient:!reconciliation(column.processName)&&column.notifyClient===true,resumeConfigurationId:resume||undefined})});const body=await response.json();if(!response.ok){if(body.configurationId)setResume(body.configurationId);throw new Error(body.error||"Não foi possível marcar a rotina.");}await onChanged();onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível marcar a rotina.");}finally{setBusy(false);}
 }
 useEffect(()=>{saveRef.current=save;});
 return <Modal opened onClose={()=>{if(!busy){void onChanged();onClose();}}} title="Marcar rotina" centered size="sm" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack gap="sm">
  <div><Text fw={700} size="sm">{client.name}</Text><Text c="dimmed" size="sm">{column.label}</Text></div>{error&&<Alert color="red">{error}</Alert>}
  {inherited?<Text size="sm" c={inheritedResponsibleId?undefined:"orange"}>{inheritedResponsibleId?"Responsável da conciliação: "+(members.find(m=>m.id===inheritedResponsibleId)?.name||members.find(m=>m.id===inheritedResponsibleId)?.email||"Colaborador definido"):"Configure primeiro o responsável da conciliação de "+(inherited==="payments"?"pagamentos":"recebimentos")+" deste cliente."}</Text>:<Select required label="Responsável" searchable data={members.map(m=>({value:m.id,label:m.name||m.email}))} value={responsibleId} onChange={setResponsibleId} disabled={busy||Boolean(resume)}/>}
  {needsFrequency&&<Select required label="Recorrência" placeholder="Selecione a frequência" data={[{value:"DAILY",label:"Diária"},{value:"WEEKLY",label:"Semanal"},{value:"FORTNIGHTLY",label:"Quinzenal"},{value:"MONTHLY",label:"Mensal"}]} value={frequency} onChange={value=>setFrequency(value as RoutineFrequency|null)} disabled={busy||Boolean(resume)}/>}
  {needsStart&&<TextInput required type="date" label="Data de início" description={custom?"A rotina respeitará os dias selecionados a partir desta data.":cadence==="MONTHLY"?"Escolha a primeira data prevista. A atividade se repetirá nesse dia de cada mês.":"A atividade se repetirá a cada 15 dias corridos a partir desta data. Fins de semana não geram atividade e feriados em dias úteis são antecipados."} value={startDate} onChange={event=>setStartDate(event.currentTarget.value)} disabled={busy||Boolean(resume)} error={startDate&&!validStart?"Selecione uma data válida.":undefined}/>}
  {custom&&<MultiSelect required label="Dias específicos do mês" data={Array.from({length:31},(_,i)=>({value:String(i+1),label:`Dia ${i+1}`}))} value={monthDays} onChange={setMonthDays} disabled={busy||Boolean(resume)}/>}
  {(!needsFrequency||frequency)&&(!custom||monthDays.length>0)&&(!needsStart||validStart)&&<Text size="sm" c="dimmed">{routineScheduleLabel(preset.recurrenceType,preset.recurrenceData)}{column.kind==="agenda"?" · Prioridade alta":""} · Início: {preset.recurrenceData.startDate.split("-").reverse().join("/")}</Text>}
  {client.team&&<Text size="sm" c="dimmed">Equipe: {client.team}</Text>}
  <Text size="xs" c="dimmed">Sábados e domingos não geram atividades nem antecipações. Apenas feriados em dias de semana são antecipados para o dia útil anterior. A agenda de 90 dias será gerada ao confirmar.</Text>
  <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>{void onChanged();onClose();}}>Cancelar</Button><Button loading={busy} disabled={Boolean(inherited&&!inheritedResponsibleId)||!responsibleId||needsFrequency&&!frequency||custom&&!monthDays.length||needsStart&&!validStart} onClick={()=>void save()}>{resume?"Retomar":"Confirmar"}</Button></Group>
 </Stack></Modal>;
}
