"use client";
import {useState} from "react";
import {Alert,Button,Group,Modal,MultiSelect,NumberInput,Select,SimpleGrid,Stack,Switch,Text,TextInput} from "@mantine/core";
import {operationToday} from "./activity-deadline";
import {shiftDay} from "./analytics";
import {routineEditSchema,type RoutineEdit} from "./edit-model";
import {routinePreset,type RoutineClient,type RoutineColumn} from "./routine-matrix";
type Member={id:string;name:string|null;email:string};
type Form=Omit<RoutineEdit,"expectedUpdatedAt">;
const weekdays=["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"].map((label,value)=>({label,value:String(value)}));
export function RoutineConfigureDialog({client,column,members,teams,onClose,onChanged}:{client:RoutineClient;column:RoutineColumn;members:Member[];teams:string[];onClose:()=>void;onChanged:()=>Promise<void>}){
 const [form,setForm]=useState<Form>(()=>({...routinePreset(column,shiftDay(operationToday(),1)),responsibleId:null,team:null,priority:"MEDIUM",notifyClient:false,auditEnabled:false}) as Form);
 const [processId,setProcessId]=useState(column.processId||""),[resume,setResume]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const schedule=form.recurrenceData,change=(patch:Partial<Form["recurrenceData"]>)=>setForm(current=>({...current,recurrenceData:{...current.recurrenceData,...patch}}));
 async function save(){
  const parsed=routineEditSchema.safeParse({...form,expectedUpdatedAt:new Date().toISOString()});if(!parsed.success){setError(parsed.error.issues[0]?.message||"Confira a programação.");return;}
  setBusy(true);setError("");
  try{
   let id=processId;
   if(!id){const response=await fetch("/api/operations/processes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:column.processName,department:"Operação",notifyClient:false})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível preparar a seção. Atualize a tabela.");id=body.process.id;setProcessId(id);}
   const response=await fetch("/api/operations/configurations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,clientId:client.id,processId:id,resumeConfigurationId:resume||undefined})});const body=await response.json();
   if(!response.ok){if(body.configurationId)setResume(body.configurationId);throw new Error(body.error||"Não foi possível salvar a rotina.");}
   await onChanged();onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível salvar a rotina.");}finally{setBusy(false);}
 }
 return <Modal opened onClose={()=>{if(!busy){void onChanged();onClose();}}} title="Configurar rotina" centered size="lg" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}><Stack>
  <div><Text fw={700}>{client.name}</Text><Text c="dimmed">{column.label}</Text></div>
  <Text size="sm" c="dimmed">A configuração será aplicada somente a este cliente. Ao salvar, a marcação é ativada e a agenda de 90 dias é gerada. O início vem preenchido com amanhã para preservar a operação de hoje; você pode ajustar a data.</Text>
  {error&&<Alert color="red">{error}</Alert>}{resume&&<Alert color="yellow">A rotina foi salva. Retome a geração para concluir sem duplicar atividades.</Alert>}
  <fieldset disabled={busy||Boolean(resume)} style={{border:0,padding:0,margin:0,minWidth:0}}><Stack>
   <SimpleGrid cols={{base:1,sm:2}}><Select label="Responsável" searchable clearable data={members.map(m=>({value:m.id,label:m.name||m.email}))} value={form.responsibleId} onChange={responsibleId=>setForm({...form,responsibleId})}/><Select label="Equipe" searchable clearable data={teams} value={form.team} onChange={team=>setForm({...form,team})}/><Select label="Prioridade" data={[{value:"LOW",label:"Baixa"},{value:"MEDIUM",label:"Média"},{value:"HIGH",label:"Alta"},{value:"CRITICAL",label:"Crítica"}]} value={form.priority} onChange={value=>setForm({...form,priority:value as Form["priority"]})}/><Select label="Recorrência" data={[{value:"ONCE",label:"Uma vez"},{value:"DAILY",label:"Diária"},{value:"WEEKLY",label:"Semanal"},{value:"MONTHLY",label:"Mensal · dias específicos"},{value:"CUSTOM",label:"Personalizada"}]} value={form.recurrenceType} onChange={value=>setForm({...form,recurrenceType:value as Form["recurrenceType"]})}/></SimpleGrid>
   {form.recurrenceType==="DAILY"&&<Select label="Dias considerados" data={[{value:"BUSINESS_DAYS",label:"Dias úteis"},{value:"ALL_DAYS",label:"Todos os dias"},{value:"CUSTOM_DAYS",label:"Dias escolhidos"}]} value={schedule.dailyMode} onChange={value=>change({dailyMode:value as Form["recurrenceData"]["dailyMode"]})}/>}
   {(["WEEKLY","CUSTOM"].includes(form.recurrenceType)||form.recurrenceType==="DAILY"&&schedule.dailyMode==="CUSTOM_DAYS")&&<MultiSelect label="Dias da semana" data={weekdays} value={schedule.weekdays.map(String)} onChange={values=>change({weekdays:values.map(Number)})}/>}
   {form.recurrenceType==="MONTHLY"&&<MultiSelect required label="Dias específicos do mês" description="Repete nesses dias a cada mês. Dias que não existem no mês não geram atividade." data={Array.from({length:31},(_,i)=>({value:String(i+1),label:`Dia ${i+1}`}))} value={schedule.monthDays.map(String)} onChange={values=>change({monthDays:values.map(Number)})}/>}
   <SimpleGrid cols={{base:1,sm:2}}><TextInput required label="Início" type="date" value={schedule.startDate} onChange={event=>change({startDate:event.currentTarget.value})}/><TextInput label="Fim opcional" type="date" min={schedule.startDate} value={schedule.endDate||""} onChange={event=>change({endDate:event.currentTarget.value||null})}/><TextInput label="Horário limite (Brasília)" type="time" value={schedule.dueTime} onChange={event=>change({dueTime:event.currentTarget.value})}/><NumberInput label="Intervalo" min={1} max={365} disabled={["ONCE","CUSTOM"].includes(form.recurrenceType)} value={schedule.interval} onChange={value=>change({interval:Number(value)})}/></SimpleGrid>
   <Select label="Quando cair em feriado" data={[{value:"KEEP",label:"Manter no feriado"},{value:"SKIP",label:"Não gerar"},{value:"PREVIOUS_BUSINESS_DAY",label:"Antecipar para dia útil"},{value:"NEXT_BUSINESS_DAY",label:"Próximo dia útil"}]} value={schedule.holidayBehavior} onChange={value=>change({holidayBehavior:value as Form["recurrenceData"]["holidayBehavior"]})}/>
   <Switch label="Enviar e-mail ao concluir" checked={form.notifyClient} onChange={event=>setForm({...form,notifyClient:event.currentTarget.checked})}/>
  </Stack></fieldset>
  <Group justify="flex-end"><Button variant="default" disabled={busy} onClick={()=>{void onChanged();onClose();}}>Cancelar</Button><Button loading={busy} onClick={()=>void save()}>{resume?"Retomar geração":"Salvar rotina e gerar agenda"}</Button></Group>
 </Stack></Modal>;
}
