"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {useDebouncedValue} from "@mantine/hooks";
import {Alert,Badge,Button,Center,Group,Loader,Pagination,Paper,ScrollArea,SegmentedControl,Stack,Table,Text,TextInput} from "@mantine/core";
import {IconMessageCircle,IconRefresh,IconSearch} from "@tabler/icons-react";
import {ChatAvatar} from "./chat-avatar";
import {SaveWhatsAppContact} from "./save-contact";
type Entry={id:string;displayName:string;externalId:string;kind:string};
type Result={accountLastDigits?:string;entries:Entry[];total:number;contacts:number;groups:number;sync:{status:string;lastError:string|null;completedAt:string|null;phase:string}|null};
export function WhatsAppDirectory({canEdit,onOpenTicket}:{canEdit:boolean;onOpenTicket:(id:string)=>void}){
 const [search,setSearch]=useState(""),[query]=useDebouncedValue(search,300),[kind,setKind]=useState("ALL"),[page,setPage]=useState(1),[result,setResult]=useState<Result|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false),[syncing,setSyncing]=useState(false),[opening,setOpening]=useState<string|null>(null);
 const request=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{
  request.current?.abort();const controller=new AbortController();request.current=controller;
  try{
   const response=await fetch("/api/whatsapp/directory?"+new URLSearchParams({search:query,kind,page:String(page)}),{signal:controller.signal,cache:"no-store"});
   const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível carregar a agenda.");
   if(!controller.signal.aborted){setResult(body);setError("");}
  }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Não foi possível carregar a agenda.");}
  finally{if(!controller.signal.aborted)setLoading(false);}
 },[query,kind,page]);
 useEffect(()=>{const initial=window.setTimeout(()=>{setLoading(true);void load();},0);const poll=window.setInterval(()=>{if(document.visibilityState==="visible")void load();},5000);return()=>{clearTimeout(initial);clearInterval(poll);request.current?.abort();};},[load]);
 async function sync(){setSyncing(true);try{const response=await fetch("/api/whatsapp/directory",{method:"POST"});const body=await response.json();if(!response.ok)throw new Error(body.error);await load();}catch(error){setError(error instanceof Error?error.message:"Falha ao atualizar a agenda.");}finally{setSyncing(false);}}
 async function open(entry:Entry){if(opening)return;setOpening(entry.id);try{const response=await fetch("/api/whatsapp/directory/"+encodeURIComponent(entry.id)+"/open",{method:"POST"});const body=await response.json();if(!response.ok)throw new Error(body.error);onOpenTicket(body.ticketId);}catch(error){setError(error instanceof Error?error.message:"Não foi possível abrir a conversa.");}finally{setOpening(null);}}
 return <Paper withBorder radius="lg" p="lg"><Stack>
  <Group justify="space-between"><Group><Text fw={800} size="lg">Contatos e grupos</Text><Badge>{result?.contacts||0} contatos salvos</Badge><Badge color="violet">{result?.groups||0} grupos</Badge></Group>{canEdit&&<Button variant="light" leftSection={<IconRefresh size={16}/>} loading={syncing} onClick={sync}>Atualizar agenda</Button>}</Group>
  <Group justify="space-between">{result?.accountLastDigits&&<Text size="sm" c="dimmed">Agenda do WhatsApp conectado · final {result.accountLastDigits}</Text>}{canEdit&&<SaveWhatsAppContact onSaved={()=>void load()}/>}</Group>
  <Group><TextInput aria-label="Buscar contatos e grupos" placeholder="Buscar por nome ou número" leftSection={<IconSearch size={16}/>} value={search} onChange={event=>{setSearch(event.currentTarget.value);setPage(1);}} style={{flex:1,minWidth:220}}/><SegmentedControl value={kind} onChange={value=>{setKind(value);setPage(1);}} data={[{value:"ALL",label:"Todos"},{value:"CONTACT",label:"Contatos"},{value:"GROUP",label:"Grupos"}]}/></Group>
  {error&&<Alert color="red">{error}</Alert>}
  {result?.sync?.lastError&&<Alert color="orange">{result.sync.lastError}</Alert>}
  {result?.sync&&["PENDING","RUNNING"].includes(result.sync.status)?<Text size="sm" c="teal">Sincronizando {result.sync.phase==="GROUPS"?"grupos":"contatos"}… A lista será atualizada automaticamente.</Text>:result?.sync?.completedAt?<Text size="xs" c="dimmed">Agenda atualizada em {new Date(result.sync.completedAt).toLocaleString("pt-BR")}</Text>:null}
  {loading&&!result?<Center p="xl"><Loader/></Center>:<ScrollArea h="calc(100dvh - 340px)" mih={280}><Table highlightOnHover verticalSpacing="sm" miw={600}><Table.Thead><Table.Tr><Table.Th>Nome</Table.Th><Table.Th>Contato</Table.Th><Table.Th>Tipo</Table.Th><Table.Th/></Table.Tr></Table.Thead><Table.Tbody>{result?.entries.map(entry=><Table.Tr key={entry.id}><Table.Td><Group wrap="nowrap"><ChatAvatar id={"directory:"+entry.id} name={entry.displayName} group={entry.kind==="GROUP"}/><Text fw={600} style={{overflowWrap:"anywhere"}}>{entry.displayName}</Text></Group></Table.Td><Table.Td>{entry.kind==="GROUP"?"Grupo do WhatsApp":entry.externalId.endsWith("@lid")?"Contato do WhatsApp": "+"+entry.externalId.split("@")[0]}</Table.Td><Table.Td><Badge variant="light" color={entry.kind==="GROUP"?"violet":"green"}>{entry.kind==="GROUP"?"Grupo":"Contato"}</Badge></Table.Td><Table.Td>{canEdit&&<Button variant="subtle" leftSection={<IconMessageCircle size={16}/>} loading={opening===entry.id} disabled={!!opening&&opening!==entry.id} onClick={()=>open(entry)}>Abrir conversa</Button>}</Table.Td></Table.Tr>)}</Table.Tbody></Table>{!result?.entries.length&&<Text p="xl" ta="center" c="dimmed">{result?.sync&&["PENDING","RUNNING"].includes(result.sync.status)?"Carregando a agenda do WhatsApp…":"Nenhum contato ou grupo encontrado."}</Text>}</ScrollArea>}
  <Group justify="space-between"><Text size="sm" c="dimmed">{result?.total||0} registros encontrados</Text><Pagination total={Math.max(1,Math.ceil((result?.total||0)/100))} value={page} onChange={setPage}/></Group>
 </Stack></Paper>;
}
