"use client";
import {ActionIcon,Button,Group,Menu,Text} from "@mantine/core";
import {IconDots,IconPin,IconPinFilled,IconPinnedOff} from "@tabler/icons-react";
import {useEffect,useEffectEvent,useState} from "react";
export function PinnedFilterControl<T>({storageKey,value,decode,onApply}:{storageKey:string|null;value:T;decode:(raw:string)=>T|null;onApply:(value:T)=>void}){
 const [saved,setSaved]=useState<T|null>(null),[error,setError]=useState("");
 const applyInitial=useEffectEvent((item:T)=>onApply(item));
 useEffect(()=>{
  let active=true;void Promise.resolve().then(()=>{if(!active)return;setSaved(null);setError("");if(!storageKey)return;try{const raw=localStorage.getItem(storageKey),item=raw?decode(raw):null;setSaved(item);if(item)applyInitial(item);}catch{/* Unavailable storage leaves the current filters usable. */}});
  return()=>{active=false;};
 },[storageKey,decode]);
 function pin(){if(!storageKey)return;const valid=decode(JSON.stringify(value));if(!valid){setError("Confira o período e os filtros antes de fixar.");return;}try{localStorage.setItem(storageKey,JSON.stringify(valid));setSaved(valid);setError("");}catch{setError("Não foi possível salvar o filtro neste navegador.");}}
 function unpin(){if(!storageKey)return;try{localStorage.removeItem(storageKey);setSaved(null);setError("");}catch{setError("Não foi possível desafixar o filtro.");}}
 const same=saved&&JSON.stringify(saved)===JSON.stringify(value);
 return <div><Group gap={4} wrap="nowrap"><Button size="xs" variant={saved?"light":"subtle"} disabled={!storageKey} leftSection={saved?<IconPinFilled size={14}/>:<IconPin size={14}/>} onClick={pin} title="Salvo para você neste navegador">{saved?same?"Filtro fixado":"Atualizar filtro fixado":"Fixar filtro atual"}</Button>{saved&&<Menu position="bottom-end" withinPortal><Menu.Target><ActionIcon size="sm" variant="subtle" aria-label="Opções do filtro fixado"><IconDots size={15}/></ActionIcon></Menu.Target><Menu.Dropdown><Menu.Label>Seu filtro neste navegador</Menu.Label><Menu.Item leftSection={<IconPin size={14}/>} onClick={()=>onApply(saved)}>Aplicar filtro fixado</Menu.Item><Menu.Item leftSection={<IconPinnedOff size={14}/>} onClick={unpin}>Desafixar filtro</Menu.Item></Menu.Dropdown></Menu>}</Group>{error&&<Text size="xs" c="red">{error}</Text>}</div>;
}
