"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Group, Modal, SimpleGrid, Stack, Text, Title, Paper } from "@mantine/core";
import { endOfDayWindow, type EndOfDaySummary } from "./end-of-day-policy";

export function EndOfDayReminder({enabled}:{enabled:boolean}) {
  const [data,setData] = useState<EndOfDaySummary|null>(null),[opened,setOpened] = useState(false),[busy,setBusy] = useState(false),[error,setError] = useState("");
  const seen = useRef("");
  useEffect(()=>{
    if (!enabled || new URLSearchParams(window.location.search).get("tv") === "1") return;
    let active=true,fetching=false;
    const check=async()=>{
      if(document.hidden||fetching)return;
      const w=endOfDayWindow();
      if(!w.due){if(active){setOpened(false);setData(null);}seen.current="";return;}
      if(seen.current===w.day)return;
      fetching=true;
      try{
        const response=await fetch("/api/notifications/end-of-day",{cache:"no-store"});
        if(!response.ok)return;
        const body=await response.json() as EndOfDaySummary;
        if(!active)return;
        if(body.acknowledged){seen.current=w.day;return;}
        if(body.eligible){setData(body);setOpened(true);seen.current=w.day;}
      }catch{}finally{fetching=false;}
    };
    void check();const timer=window.setInterval(()=>void check(),30000);
    const visible=()=>{if(!document.hidden)void check();};document.addEventListener("visibilitychange",visible);
    // Shared TV windows keep their unattended presentation running.
    return()=>{active=false;clearInterval(timer);document.removeEventListener("visibilitychange",visible);};
  },[enabled]);
  useEffect(()=>{
    if(!data)return;
    const changed=(event:StorageEvent)=>{if(event.key===`fortuno:eod:${data.viewerKey}:${data.day}`)setOpened(false);};
    window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);
  },[data]);
  async function close(href?:string){
    if(busy)return;setBusy(true);setError("");
    try{const r=await fetch("/api/notifications/end-of-day",{method:"POST"});if(!r.ok)throw new Error();setOpened(false);if(data){try{localStorage.setItem(`fortuno:eod:${data.viewerKey}:${data.day}`,"read");}catch{}}if(href)window.location.assign(href);}
    catch{setError("Não foi possível registrar a leitura. Tente novamente.");}finally{setBusy(false);}
  }
  const cards=data?[{label:"Seus chamados WhatsApp em aberto",value:data.calls,href:"/whatsapp",color:"orange"},{label:"Seus e-mails em aberto",value:data.email,href:"/atendimento",color:"blue"},{label:"Suas tarefas abertas até hoje",value:data.tasks,href:"/operacoes",color:"blue"},{label:"Suas tarefas com prazo vencido",value:data.overdue,href:"/operacoes",color:"red"},{label:"Avisos não lidos",value:data.unread,href:"/avisos",color:"orange"}].filter(c=>c.value!==null):[];
  return <Modal fullScreen opened={opened&&enabled} onClose={()=>void close()} withCloseButton={false} closeOnEscape={false} closeOnClickOutside={false} zIndex={11000} title="Fechamento do dia" styles={{body:{maxWidth:1100,margin:"0 auto",padding:"28px 24px"}}}>
    {data&&<Stack gap="xl"><Group justify="space-between"><div><Badge color="blue">18h · horário de Brasília</Badge><Title order={1} mt="sm">Antes de encerrar o dia</Title><Text c="dimmed">Confira suas pendências e prepare o dia de amanhã.</Text></div><Button loading={busy} onClick={()=>void close()}>Entendi, continuar no Hub</Button></Group>
      {error&&<Alert color="red">{error}</Alert>}
      <SimpleGrid cols={{base:1,sm:2,lg:3}}>{cards.map(c=><Paper key={c.label} withBorder radius="lg" p="xl"><Text size="sm" c="dimmed">{c.label}</Text><Text fw={800} size="36px" c={c.value?c.color:"teal"}>{c.value}</Text><Button component="a" href={c.href} variant="light" mt="sm" onClick={event=>{event.preventDefault();void close(c.href);}}>Ver pendências</Button></Paper>)}</SimpleGrid>
      <Alert color={cards.some(c=>Number(c.value)>0)?"orange":"teal"}>{cards.some(c=>Number(c.value)>0)?"Revise as pendências antes de sair. Finalize somente o que já foi atendido e alinhe o que precisar continuar amanhã.":"Nenhuma pendência encontrada nos módulos disponíveis para você."} Tarefas futuras não entram nas abertas de hoje; as vencidas também fazem parte das tarefas pendentes.</Alert>
      <div><Title order={2}>Sua agenda de amanhã · {data.tomorrow.split("-").reverse().join("/")}</Title><Text size="sm" c="dimmed" mb="md">Compromissos registrados na sua agenda do Hub.</Text><Stack gap="sm">{!data.calendarAvailable?<Text>Agenda indisponível para seu perfil.</Text>:!data.agenda.length?<Text c="dimmed">Nenhum compromisso registrado para amanhã.</Text>:data.agenda.map(event=><Paper key={event.id} withBorder p="md" radius="md"><Group justify="space-between"><div><Text fw={700}>{event.title}</Text><Text c="dimmed" size="sm">{new Date(event.startsAt).toLocaleTimeString("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"})} – {new Date(event.endsAt).toLocaleTimeString("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"})}</Text></div><Button component="a" href={event.href} variant="subtle" onClick={e=>{e.preventDefault();void close(event.href);}}>Abrir agenda</Button></Group></Paper>)}</Stack>{data.agendaTotal>data.agenda.length&&<Text mt="sm">Exibindo {data.agenda.length} de {data.agendaTotal}. Consulte os demais na Agenda.</Text>}</div>
    </Stack>}
  </Modal>;
}
