"use client";
import {ActionIcon,Alert,Button,Group,Image,Modal,Paper,Progress,Select,Stack,Text,Textarea,Tooltip} from "@mantine/core";
import {IconPaperclip,IconTrash,IconUpload} from "@tabler/icons-react";
import {notifications} from "@mantine/notifications";
import {useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {createClient} from "@/lib/supabase/client";
import {WHATSAPP_FILE_ACCEPT,WHATSAPP_FILE_COUNT,whatsappFileInfo} from "./outbound-files";
import styles from "@/app/(platform)/whatsapp/whatsapp.module.css";
type Upload={id:string;file:File;asDocument:boolean;state:"PENDING"|"UPLOADING"|"SENDING"|"SENT"|"FAILED"|"UNCONFIRMED";error?:string};
function ImagePreview({file}:{file:File}){
 const src=useMemo(()=>URL.createObjectURL(file),[file]);useEffect(()=>()=>URL.revokeObjectURL(src),[src]);
 return <Image src={src} alt={file.name} fit="contain" h={110} radius="sm"/>;
}
export function WhatsAppAttachmentSender({ticketId,recipient,canSend,onSent,children}:{ticketId:string;recipient:string;canSend:boolean;onSent:()=>void;children:(attachmentButton:ReactNode,busy:boolean)=>ReactNode}){
 const input=useRef<HTMLInputElement>(null),mounted=useRef(true),active=useRef(false),dragDepth=useRef(0);
 const [files,setFiles]=useState<Upload[]>([]),[opened,setOpened]=useState(false),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false),[caption,setCaption]=useState("");
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 function choose(chosen:File[]){
   if(!canSend||active.current){notifications.show({color:"orange",message:"Assuma o chamado e aguarde o envio atual antes de anexar."});return;}
   if(chosen.length+files.length>WHATSAPP_FILE_COUNT){notifications.show({color:"orange",message:"Selecione até 10 anexos por envio."});return;}
   try{chosen.forEach(file=>whatsappFileInfo(file.name,file.size));setFiles(previous=>[...previous,...chosen.map(file=>({id:crypto.randomUUID(),file,asDocument:false,state:"PENDING" as const}))]);if(chosen.length)setOpened(true);}catch(e){notifications.show({color:"red",message:e instanceof Error?e.message:"Arquivo inválido."});}
 }
 const open=()=>{if(canSend&&!active.current)input.current?.click();};
 const update=(id:string,data:Partial<Upload>)=>{if(mounted.current)setFiles(previous=>previous.map(item=>item.id===id?{...item,...data}:item));};
 async function send(){
   if(active.current||!canSend)return;
   active.current=true;setBusy(true);
   try{
     const supabase=createClient();
     for(const item of files){
       if(!mounted.current)break;
       if(!["PENDING","FAILED"].includes(item.state))continue;
       let sendStarted=false;
       try{
         update(item.id,{state:"UPLOADING",error:undefined});
         const preparation=await fetch(`/api/whatsapp/${ticketId}/media`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"prepare",name:item.file.name,size:item.file.size})});
         const upload=await preparation.json();if(!preparation.ok)throw new Error(upload.error||"Não foi possível preparar o anexo.");
         if(!mounted.current)break;
         const stored=await supabase.storage.from(upload.bucket).uploadToSignedUrl(upload.path,upload.token,item.file,{contentType:upload.mimeType});
         if(stored.error)throw new Error("Não foi possível carregar o arquivo. Tente novamente.");
         if(!mounted.current)break;
         update(item.id,{state:"SENDING"});sendStarted=true;
         const response=await fetch(`/api/whatsapp/${ticketId}/media`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"send",uploadId:upload.uploadId,caption,asDocument:item.asDocument})});
         const body=await response.json();if(!response.ok)throw new Error(body.error||"Envio sem confirmação. Confira a conversa.");
         update(item.id,{state:"SENT"});onSent();
       }catch(error){update(item.id,{state:sendStarted?"UNCONFIRMED":"FAILED",error:error instanceof Error?error.message:"Falha ao enviar o anexo."});break;}
     }
   }finally{active.current=false;if(mounted.current)setBusy(false);}
 }
 const attachmentButton=<Tooltip label="Anexar arquivo"><ActionIcon variant="subtle" aria-label="Anexar arquivo" disabled={!canSend||busy} onClick={open}><IconPaperclip size={20}/></ActionIcon></Tooltip>;
 const pending=files.some(file=>["PENDING","FAILED"].includes(file.state));
 const labels={PENDING:"Pronto para enviar",UPLOADING:"Carregando arquivo…",SENDING:"Enviando ao WhatsApp…",SENT:"Enviado",FAILED:"Falha no upload",UNCONFIRMED:"Envio sem confirmação · confira a conversa antes de repetir"};
 return <div className={styles.attachmentDropZone} onDragEnter={event=>{if(event.dataTransfer.types.includes("Files")){event.preventDefault();dragDepth.current++;if(canSend&&!busy)setDragging(true);}}} onDragOver={event=>{if(event.dataTransfer.types.includes("Files")){event.preventDefault();event.dataTransfer.dropEffect=canSend&&!busy?"copy":"none";}}} onDragLeave={event=>{event.preventDefault();if(--dragDepth.current<=0){dragDepth.current=0;setDragging(false);}}} onDrop={event=>{if(!event.dataTransfer.types.includes("Files"))return;event.preventDefault();dragDepth.current=0;setDragging(false);choose(Array.from(event.dataTransfer.files));}}>
   <input hidden ref={input} type="file" aria-label="Selecionar anexos do WhatsApp" accept={WHATSAPP_FILE_ACCEPT} multiple onChange={event=>{choose(Array.from(event.currentTarget.files||[]));event.currentTarget.value="";}}/>
   {children(attachmentButton,busy)}
   {dragging&&<div className={styles.attachmentDropOverlay}><IconUpload size={34}/><strong>Solte os arquivos aqui</strong><span>Você poderá revisar antes de enviar</span></div>}
   <Modal opened={opened} onClose={()=>{if(!busy){setOpened(false);setFiles([]);setCaption("");}}} title="Enviar anexos" size="lg" centered closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy}>
    <Stack><Text size="sm">Para: <strong>{recipient}</strong></Text><Text size="xs" c="dimmed">Até 10 arquivos, com até 25 MB cada. O envio ocorre somente ao clicar em Enviar anexos.</Text>
     {files.map(item=>{const info=whatsappFileInfo(item.file.name,item.file.size);return <Paper key={item.id} withBorder radius="md" p="sm"><Group wrap="nowrap" align="flex-start"><div style={{flex:1,minWidth:0}}><Text fw={650} size="sm" style={{overflowWrap:"anywhere"}}>{item.file.name}</Text><Text size="xs" c="dimmed">{(item.file.size/1024/1024).toLocaleString("pt-BR",{maximumFractionDigits:2})} MB · {labels[item.state]}</Text>{info.type==="image"&&<ImagePreview file={item.file}/>} {info.type!=="document"&&<Select label="Enviar como" size="xs" mt="xs" value={item.asDocument?"document":info.type} disabled={busy||["SENT","UNCONFIRMED"].includes(item.state)} data={[{value:info.type,label:info.type==="image"?"Imagem":info.type==="video"?"Vídeo":"Áudio"},{value:"document",label:"Documento (arquivo original)"}]} onChange={value=>update(item.id,{asDocument:value==="document"})}/>} {item.error&&<Alert color="red" mt="xs">{item.error}</Alert>}{["UPLOADING","SENDING"].includes(item.state)&&<Progress animated value={item.state==="UPLOADING"?40:85} mt="xs"/>}</div><ActionIcon variant="subtle" color="gray" aria-label={`Remover ${item.file.name}`} disabled={busy||item.state==="SENT"||item.state==="UNCONFIRMED"} onClick={()=>setFiles(previous=>previous.filter(file=>file.id!==item.id))}><IconTrash size={17}/></ActionIcon></Group></Paper>;})}
     <Textarea label="Legenda (opcional)" placeholder="Escreva uma mensagem para acompanhar os arquivos" maxLength={5000} value={caption} onChange={event=>setCaption(event.currentTarget.value)} disabled={busy||files.some(file=>file.state==="SENT")}/>
     <Group justify="space-between"><Button variant="subtle" leftSection={<IconPaperclip size={16}/>} onClick={open} disabled={busy||files.length>=WHATSAPP_FILE_COUNT}>Adicionar arquivos</Button><Button leftSection={<IconUpload size={16}/>} onClick={()=>void send()} loading={busy} disabled={!canSend||!pending}>Enviar anexos</Button></Group>
    </Stack>
   </Modal>
 </div>;
}
