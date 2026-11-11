"use client";
import {useState} from "react";
import {Button,Text,Alert,Stack} from "@mantine/core";
export function AudioTranscription({conversationId,attachmentId,initialText}:{conversationId:string;attachmentId:string;initialText?:string|null}){
 const [text,setText]=useState(initialText||""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function transcribe(){setBusy(true);setError("");try{const response=await fetch(`/api/whatsapp/${conversationId}/attachments/${attachmentId}/transcribe`,{method:"POST"});const body=await response.json();if(!response.ok)throw new Error(body.error||"Falha na transcrição.");setText(body.text);}catch(e){setError(e instanceof Error?e.message:"Falha na transcrição.");}finally{setBusy(false);}}
 return <Stack gap={5}>{text?<><Text size="xs" c="dimmed">Transcrição do áudio</Text><Text size="sm" style={{whiteSpace:"pre-wrap"}}>{text}</Text></>:<Button variant="subtle" size="compact-xs" loading={busy} onClick={()=>void transcribe()}>Transcrever áudio</Button>}{error&&<Alert color="orange" p="xs">{error}</Alert>}</Stack>;
}
