"use client";
import {useCallback,useEffect,useState} from "react";
import {Alert,Badge,Button,Group,Modal,Paper,PasswordInput,Stack,Text,Textarea,Title} from "@mantine/core";
import {jsonRequest,meetingRequest,type Meeting} from "./client";
type Connection={id:string;enabled:boolean;lastSyncAt:string|null;error:string|null};
export function FathomSettings({canEdit}:{canEdit:boolean}){
 const [opened,setOpened]=useState(false),[connection,setConnection]=useState<Connection|null>(null),[key,setKey]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 async function load(){try{const data=await meetingRequest<{connection:Connection|null}>("/api/meetings/fathom");setConnection(data.connection);}catch(error){setError(error instanceof Error?error.message:"Não foi possível consultar o Fathom.");}}
 async function save(action:string){setBusy(true);setError("");setMessage("");try{await meetingRequest("/api/meetings/fathom",action==="disconnect"?{method:"DELETE"}:jsonRequest("POST",{action,...(action==="connect"?{apiKey:key}:{})}));setKey("");await load();setMessage(action==="disconnect"?"Recebimento desativado no Hub. Isso não desativa a captura no Fathom.":action==="connect"?"Conexão e recebimento automático configurados. Conecte também sua agenda no Fathom e confira a captura da reunião.":"Sincronização solicitada. O conteúdo disponível aparecerá nas reuniões marcadas para usar Fathom.");}catch(error){setError(error instanceof Error?error.message:"Falha ao conectar.");}finally{setBusy(false);}}
 return <><Button variant="default" onClick={()=>{setOpened(true);void load();}}>Conexão Fathom</Button><Modal opened={opened} onClose={()=>!busy&&setOpened(false)} title="Fathom · gravação e transcrição" size="lg"><Stack>
 <Text size="sm">Conecte no Fathom a mesma conta Google e a agenda principal usadas para marcar os Meets. Confira no Fathom quais reuniões serão capturadas.</Text>
 <Group><Button component="a" href="https://fathom.video/customize" target="_blank" rel="noopener noreferrer" variant="light">Abrir configurações do Fathom</Button><Button component="a" href="/agenda" variant="subtle">Minha agenda no Hub</Button></Group>
 <Text size="sm">Em Fathom → Configurações → API Access, gere uma chave e preencha abaixo. Ela ficará criptografada no servidor. Cada colaborador pode conectar a própria conta.</Text>
 {connection?.enabled&&<Badge color="green">Conectado · recebimento automático ativo</Badge>}
 {connection?.lastSyncAt&&<Text size="xs">Última sincronização: {new Date(connection.lastSyncAt).toLocaleString("pt-BR")}</Text>}
 {connection?.error&&<Alert color="orange">{connection.error}</Alert>}
 {canEdit&&<><PasswordInput label={connection?.enabled?"Nova chave de API do Fathom (para substituir)":"Chave de API do Fathom"} autoComplete="off" value={key} onChange={event=>setKey(event.currentTarget.value)}/><Button disabled={!key.trim()} loading={busy} onClick={()=>void save("connect")}>Conectar Fathom e ativar recebimento</Button>{connection?.enabled&&<Group><Button variant="light" disabled={busy} onClick={()=>void save("sync")}>Sincronizar agora</Button><Button variant="subtle" color="red" disabled={busy} onClick={()=>void save("disconnect")}>Desconectar do Hub</Button></Group>}</>}
 <Alert color="blue">A opção no Hub controla a importação. A entrada e a gravação do assistente no Meet são configuradas no Fathom. Desmarcar no Hub não interrompe uma captura já habilitada no Fathom.</Alert>
 {error&&<Alert color="red">{error}</Alert>}{message&&<Alert color="green">{message}</Alert>}
 </Stack></Modal></>;
}
function FathomRecordingCard({recording}:{recording:NonNullable<Meeting["fathomRecordings"]>[number]}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[url,setUrl]=useState(""),[attempt,setAttempt]=useState(0);
 const prepare=useCallback(async()=>{setBusy(true);setError("");try{const data=await meetingRequest<{status:string;url?:string}>("/api/meetings/fathom",jsonRequest("POST",{action:"download",id:recording.id}));if(data.url){setUrl(data.url);setAttempt(0);}else setAttempt(value=>value+1);}catch(error){setError(error instanceof Error?error.message:"Não foi possível obter o arquivo.");setAttempt(0);}finally{setBusy(false);}},[recording.id]);
 useEffect(()=>{if(!attempt)return;if(attempt>=12)return;const timer=setTimeout(()=>void prepare(),5000);return ()=>clearTimeout(timer);},[attempt,prepare]);
 return <Paper withBorder p="md"><Stack gap="sm"><Group justify="space-between"><Text fw={700}>{recording.title}</Text><Badge color="green">Recebido do Fathom</Badge></Group>
 <Group><Button component="a" href={recording.playbackUrl} target="_blank" rel="noopener noreferrer" variant="light">Assistir gravação no Fathom</Button>{url?<Button component="a" href={url} target="_blank" rel="noopener noreferrer" variant="light">Abrir arquivo da gravação</Button>:<Button loading={busy||attempt>0&&attempt<12} variant="default" onClick={()=>void prepare()}>Preparar download da gravação</Button>}</Group>
 {attempt>=12&&<Text size="sm">O Fathom ainda está preparando o arquivo. Tente novamente em instantes.</Text>}{error&&<Alert color="orange">{error}</Alert>}
 <Text size="xs" c="dimmed">O vídeo permanece armazenado no Fathom. O Hub guarda a transcrição e o resumo; o link de download é temporário.</Text>
 <Title order={5}>Resumo organizado pelo Fathom</Title><Text size="sm" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{recording.summary||"O Fathom ainda não disponibilizou o resumo."}</Text>
 {recording.actionItems&&<><Title order={5}>Atividades sugeridas pelo Fathom</Title><Text size="sm" style={{whiteSpace:"pre-wrap"}}>{recording.actionItems}</Text><Text size="xs" c="dimmed">Revise e distribua as tarefas no checklist para definir responsáveis e prazos no Hub.</Text></>}
 <Textarea label="Transcrição com participantes e horários" value={recording.transcript||"Transcrição ainda não disponibilizada pelo Fathom."} readOnly autosize minRows={4} maxRows={16}/>
 </Stack></Paper>;
}
export function FathomMeetingPanel({meeting}:{meeting:Meeting}){
 return <Paper withBorder radius="lg" p="lg"><Stack><Group><Title order={4}>Gravação e transcrição · Fathom</Title><Badge color={meeting.fathomEnabled?"blue":"gray"}>{meeting.fathomEnabled?"Importação habilitada":"Somente registros do Hub"}</Badge></Group>
 {!meeting.fathomEnabled?<Text size="sm">O relatório desta reunião usa as anotações e atividades registradas no Hub.</Text>:<><Text size="sm">Após o processamento no Fathom, a gravação, o resumo e a transcrição aparecem aqui automaticamente. Confira a captura desta chamada na agenda do Fathom.</Text>{!meeting.fathomRecordings?.length&&<Alert color="blue">Aguardando conteúdo do Fathom. É necessário conectar a conta e a agenda, habilitar a captura no Fathom e usar o mesmo link do Meet e horário desta reunião.</Alert>}{meeting.fathomRecordings?.map(recording=><FathomRecordingCard key={recording.id} recording={recording}/>)}</>}
 </Stack></Paper>;
}
