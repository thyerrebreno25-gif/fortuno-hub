"use client";
import { ActionIcon, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBell, IconBellOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";
export function WhatsAppNotificationToggle() {
  const [muted,setMuted]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;void fetch('/api/whatsapp/preferences',{cache:'no-store'}).then(async r=>{if(!r.ok)return;const b=await r.json();if(alive){setMuted(b.notificationsMuted);setReady(true);}}).catch(()=>{});
    const heartbeat=()=>{if(document.visibilityState==='visible')void fetch('/api/whatsapp/preferences',{method:'POST'}).catch(()=>{});};heartbeat();const timer=setInterval(heartbeat,60000);document.addEventListener('visibilitychange',heartbeat);return()=>{alive=false;clearInterval(timer);document.removeEventListener('visibilitychange',heartbeat);};},[]);
  const toggle=async()=>{setBusy(true);try{const r=await fetch('/api/whatsapp/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({notificationsMuted:!muted})});if(!r.ok)throw new Error();setMuted(!muted);window.dispatchEvent(new CustomEvent('fortuno:whatsapp-notifications-muted',{detail:{muted:!muted}}));window.dispatchEvent(new Event('fortuno:notifications-refresh'));notifications.show({message:muted?'Avisos e som de novas mensagens ativados.':'Avisos e som de novas mensagens silenciados. As contagens de não lidas continuam visíveis.',color:'teal'});}catch{notifications.show({message:'Não foi possível salvar a preferência de notificações.',color:'red'});}finally{setBusy(false);}};
  return <Tooltip label={muted?'Ativar avisos e som do WhatsApp':'Silenciar avisos e som do WhatsApp'}><ActionIcon variant="subtle" color={muted?'gray':'teal'} size="lg" aria-label={muted?'Ativar avisos e som do WhatsApp':'Silenciar avisos e som do WhatsApp'} aria-pressed={muted} disabled={!ready} loading={busy} onClick={toggle}>{muted?<IconBellOff size={19}/>:<IconBell size={19}/>}</ActionIcon></Tooltip>;
}
