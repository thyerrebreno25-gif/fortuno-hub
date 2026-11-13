"use client";
import {useState} from "react";
import {ActionIcon,Popover,ScrollArea,SimpleGrid,Stack,TextInput,Text,Tooltip} from "@mantine/core";
import {IconMoodSmile} from "@tabler/icons-react";
const emojis=[
 ["😀","sorriso feliz"],["😃","alegria"],["😊","sorriso gentil"],["🙂","sorrindo"],["😉","piscada"],["😄","feliz"],["😁","sorriso"],["😅","alivio"],["😂","risada"],["🤣","rindo"],["😍","apaixonado"],["🥰","carinho"],["😎","legal"],["🤔","pensando"],["😔","triste"],["😢","chorando"],["🙏","obrigado por favor"],["👍","positivo ok"],["👎","negativo"],["👏","palmas"],["🙌","celebrar"],["🤝","acordo"],["👋","ola tchau"],["👌","certo"],["💪","forca"],["❤️","coracao amor"],["💙","coracao azul"],["💚","coracao verde"],["🎉","festa parabens"],["🎊","comemorar"],["✅","concluido feito"],["✔️","check"],["❌","erro nao"],["⚠️","atencao"],["🚨","urgente"],["📌","importante"],["📅","agenda data"],["⏰","horario prazo"],["💰","dinheiro"],["💳","cartao"],["🧾","recibo"],["📄","documento"],["📎","anexo"],["📊","relatorio"],["📩","mensagem"],["☎️","telefone"],["🚀","avancar"],["☀️","bom dia"],["🌙","boa noite"],["☕","cafe"],
];
const normalized=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function ComposerEmojiPicker({onInsert,disabled}:{onInsert:(emoji:string)=>void;disabled:boolean}){
 const [opened,setOpened]=useState(false),[query,setQuery]=useState("");const choices=emojis.filter(([emoji,name])=>normalized(name+emoji).includes(normalized(query)));
 return <Popover opened={opened} onChange={setOpened} position="top-start" withinPortal><Popover.Target><Tooltip label="Adicionar emoji"><ActionIcon aria-label="Adicionar emoji" variant="subtle" disabled={disabled} onClick={()=>setOpened(v=>!v)}><IconMoodSmile size={20}/></ActionIcon></Tooltip></Popover.Target><Popover.Dropdown w={290}><Stack gap="xs"><Text size="sm" fw={700}>Emojis</Text><TextInput placeholder="Buscar emoji" value={query} onChange={e=>setQuery(e.currentTarget.value)}/><ScrollArea h={230}><SimpleGrid cols={6} spacing={4}>{choices.map(([emoji,name])=><ActionIcon key={emoji} variant="subtle" size={35} aria-label={name} title={name} onClick={()=>{onInsert(emoji);setOpened(false);}}><span style={{fontSize:23}}>{emoji}</span></ActionIcon>)}</SimpleGrid>{!choices.length&&<Text size="xs" c="dimmed">Nenhum emoji encontrado.</Text>}</ScrollArea></Stack></Popover.Dropdown></Popover>;
}
