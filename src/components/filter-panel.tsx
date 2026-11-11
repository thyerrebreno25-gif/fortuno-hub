"use client";
import { useId, useState, type ReactNode } from "react";
import { Badge, Button, Collapse, Group } from "@mantine/core";
import { IconChevronDown, IconChevronUp, IconFilter } from "@tabler/icons-react";

export function FilterPanel({children,title="Filtros",activeCount=0}:{children:ReactNode;title?:string;activeCount?:number}) {
  const [opened,setOpened] = useState(false); const id = useId();
  return <div style={{minWidth:0,maxWidth:"100%",flexShrink:0}}><Group gap="xs"><Button variant="light" size="xs" leftSection={<IconFilter size={15}/>} rightSection={opened ? <IconChevronUp size={14}/> : <IconChevronDown size={14}/>} aria-expanded={opened} aria-controls={id} onClick={()=>setOpened(v=>!v)}>{opened ? `Ocultar ${title.toLocaleLowerCase("pt-BR")}` : title}</Button>{activeCount>0&&<Badge size="xs" variant="light">{activeCount} ativo(s)</Badge>}</Group><Collapse expanded={opened} keepMounted id={id}><div style={{paddingTop:12,minWidth:0}}>{children}</div></Collapse></div>;
}
