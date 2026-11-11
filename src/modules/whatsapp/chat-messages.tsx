"use client";
import { ActionIcon, Alert, Loader, Stack, Button, Group, Image, Modal, Popover, Text, Tooltip } from "@mantine/core";
import { IconArrowDown, IconDownload, IconMoodSmile, IconCornerUpLeft } from "@tabler/icons-react";
import {notifications} from "@mantine/notifications";
import {REACTION_EMOJIS,type MessageReaction} from "./reaction-core";
import type {QuotedMessage} from "./quote-core";
import {QuotedMessagePreview} from "./quoted-message";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {AudioTranscription} from "./audio-transcription";
import {CreateFinancialEntry} from "./create-financial-entry";
import {ForwardMessage} from "./forward-message";
import {MessageActions} from "./message-actions";
import {ImageZoomViewer} from "./image-zoom-viewer";
import { mediaKind } from "./media";
import styles from "@/app/(platform)/whatsapp/whatsapp.module.css";
type Attachment = { id: string; name: string; mimeType: string | null };
type Message = { id: string; sourceTicketId?: string; direction: "INBOUND" | "OUTBOUND" | "INTERNAL"; fromName: string | null; textBody: string | null; receivedAt: string; deliveryStatus: string | null; forwarded?:boolean;audioTranscript?:string|null;deletedAt?:string|null;editedAt?:string|null; replyTo?:QuotedMessage|null; reaction?:MessageReaction|null; customerReactions?:MessageReaction[]; attachments: Attachment[] };
const delivery: Record<string, string> = { accepted: "Enviando", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falha no envio" };
function AttachmentPreview({ conversationId, attachment, message, transcript }: { conversationId: string; attachment: Attachment; message: string;transcript?:string|null }) {
  const [opened, setOpened] = useState(false), [failed, setFailed] = useState(false);
  const src = `/api/whatsapp/${conversationId}/attachments/${attachment.id}`;
  const preview = src + "?preview=1";
  const kind = mediaKind(attachment.mimeType, attachment.name, message);
  return <div className={styles.attachment}>
    {!failed && kind === "image" && <><button type="button" className={styles.imageButton} onClick={() => setOpened(true)} aria-label="Ampliar imagem"><Image loading="lazy" decoding="async" src={preview} alt="Imagem da mensagem" fit="contain" className={styles.chatImage} onError={() => setFailed(true)} /></button><Modal opened={opened} onClose={() => setOpened(false)} title="Imagem da mensagem" size="xl" centered>{opened&&<ImageZoomViewer src={preview} download={src}/>}</Modal></>}
    {!failed && kind === "audio" && <audio controls preload="none" src={preview} className={styles.chatAudio} onError={() => setFailed(true)}>Seu navegador não suporta áudio.</audio>}
    {!failed && kind === "video" && <video controls preload="none" src={preview} className={styles.chatVideo} onError={() => setFailed(true)}><track kind="captions" />Seu navegador não suporta vídeo.</video>}
    {kind==="audio"&&<AudioTranscription conversationId={conversationId} attachmentId={attachment.id} initialText={transcript}/>}
    {failed && <Text size="xs" c="red">Não foi possível carregar a prévia. Tente baixar o arquivo.</Text>}
    <Button component="a" href={src} target="_blank" rel="noreferrer" size="compact-xs" variant="subtle" color="gray" leftSection={<IconDownload size={13} />}>{kind === "file" ? attachment.name : kind === "audio" ? "Baixar áudio" : kind === "video" ? "Baixar vídeo" : "Baixar imagem"}</Button>
  </div>;
}
export const ChatMessages = memo(function ChatMessages({ conversationId, messages, senderName, hasOlder, loadingOlder, onLoadOlder, onRead, canReact, onReaction, canReply, onReply, onChanged, clientId, clientName }: { conversationId: string; messages: Message[]; senderName: string;clientId?:string|null;clientName?:string|null; hasOlder?: boolean; loadingOlder?: boolean; onLoadOlder?: () => void; onRead?: (id: string, messageId: string, sourceTicketId?:string) => void; canReact?:boolean;onReaction?:(conversationId:string,messageId:string,reaction:MessageReaction)=>void;onChanged?:()=>void;canReply?:boolean;onReply?:(conversationId:string,quote:QuotedMessage)=>void }) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const sticky = useRef(true), previous = useRef({ conversationId: "", lastId: "" });
  const reviewRequest=useRef<AbortController|null>(null);
  const [highlightId,setHighlightId]=useState<string|null>(null);
  const [review,setReview]=useState<{loading:boolean;error?:string;quote:QuotedMessage;message?:{id:string;sourceTicketId:string;fromName:string|null;textBody:string|null;receivedAt:string;attachments:Attachment[]}}|null>(null);
  useEffect(()=>()=>reviewRequest.current?.abort(),[conversationId]);
  useEffect(()=>{if(!highlightId)return;const timer=setTimeout(()=>setHighlightId(null),2200);return()=>clearTimeout(timer);},[highlightId]);
  const openOriginal=useCallback(async(quote:QuotedMessage)=>{
    const original=quote.id?viewport.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(quote.id)}"]`):null;
    if(original){sticky.current=false;original.scrollIntoView({block:"center",behavior:"smooth"});setHighlightId(quote.id);return;}
    reviewRequest.current?.abort();
    if(!quote.id){setReview({loading:false,quote,error:"A mensagem original ainda não está no histórico sincronizado. A referência disponível aparece abaixo."});return;}
    const controller=new AbortController();reviewRequest.current=controller;setReview({loading:true,quote});
    try{const response=await fetch(`/api/whatsapp/${conversationId}/messages/${encodeURIComponent(quote.id)}`,{cache:"no-store",signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível abrir a mensagem original.");if(!controller.signal.aborted)setReview({loading:false,quote,message:body.message});}catch(error){if(!controller.signal.aborted)setReview({loading:false,quote,error:error instanceof Error?error.message:"Não foi possível abrir a mensagem original."});}
  },[conversationId]);
  const firstMessageId = messages[0]?.id;
  const prepend = useRef<{id:string;top:number;height:number}|null>(null);
  useLayoutEffect(() => { const saved = prepend.current; const node = viewport.current; if (saved && node && saved.id === conversationId) node.scrollTop = saved.top + node.scrollHeight - saved.height; prepend.current = null; }, [conversationId, firstMessageId]);
  const [hasNew, setHasNew] = useState(false);
  const last = messages.at(-1);
  const lastConfirmed = messages.filter(message => !message.id.startsWith("pending:")).at(-1);
  useEffect(() => {
    const switched = previous.current.conversationId !== conversationId;
    const changed = previous.current.lastId !== (last?.id || "");
    previous.current = { conversationId, lastId: last?.id || "" };
    if (!switched && !changed) return;
    const frame = requestAnimationFrame(() => {
      if (switched || sticky.current || last?.direction === "OUTBOUND" && last.id.startsWith("pending:")) {
        sticky.current = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; setHasNew(false);
      } else setHasNew(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [conversationId, last?.id, last?.direction]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (sticky.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; });
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const visibleRead = () => { const el = viewport.current; if (lastConfirmed?.id && el && document.visibilityState === "visible" && el.scrollHeight - el.scrollTop - el.clientHeight < 90) onRead?.(conversationId, lastConfirmed.id, lastConfirmed.sourceTicketId); };
    const timer = setTimeout(visibleRead, 700);
    const el = viewport.current;
    el?.addEventListener("scroll", visibleRead, { passive: true });
    document.addEventListener("visibilitychange", visibleRead);
    window.addEventListener("focus", visibleRead);
    return () => { clearTimeout(timer); el?.removeEventListener("scroll", visibleRead); document.removeEventListener("visibilitychange", visibleRead); window.removeEventListener("focus", visibleRead); };
  }, [conversationId, lastConfirmed?.id, lastConfirmed?.sourceTicketId, onRead]);
  return <div className={styles.messagesFrame}>
    <div ref={viewport} className={styles.messages} role="log" aria-label="Mensagens da conversa" data-conversation-id={conversationId} onScroll={() => { const el = viewport.current; if (!el) return; sticky.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; if (sticky.current) setHasNew(false); }}>
      <div ref={content}>{hasOlder && <Group justify="center" py="sm"><Button variant="light" size="xs" loading={loadingOlder} onClick={() => { sticky.current = false; if (viewport.current) prepend.current = {id:conversationId,top:viewport.current.scrollTop,height:viewport.current.scrollHeight}; onLoadOlder?.(); }}>Carregar mensagens anteriores</Button></Group>}{messages.map((message,index)=><Fragment key={message.id}>{message.sourceTicketId&&message.sourceTicketId!==messages[index-1]?.sourceTicketId&&message.sourceTicketId!==conversationId&&<Group justify="center" py="sm"><Text size="xs" c="dimmed">Histórico de atendimento anterior</Text></Group>}<MessageBubble message={message} conversationId={conversationId} senderName={senderName} canReact={canReact} onReaction={onReaction} canReply={canReply} onReply={onReply} onOpenOriginal={openOriginal} clientId={clientId} clientName={clientName} onChanged={onChanged} highlighted={message.id===highlightId}/></Fragment>)}</div>
    </div>
    <Modal opened={Boolean(review)} onClose={()=>{reviewRequest.current?.abort();setReview(null);}} title="Mensagem original" size="lg" centered><Stack>{review?.loading?<Loader size="sm"/>:<>{review?.error&&<Alert color="orange">{review.error}</Alert>}{review?.message?<><Group justify="space-between"><Text fw={750}>{review.message.fromName||"Mensagem original"}</Text><Text size="xs" c="dimmed">{messageTime.format(new Date(review.message.receivedAt))}</Text></Group><Text style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{review.message.textBody}</Text>{review.message.attachments.map(attachment=><AttachmentPreview key={attachment.id} conversationId={review.message!.sourceTicketId} attachment={attachment} message={review.message!.textBody||""}/>)}</>:review&&<QuotedMessagePreview quote={review.quote}/>}</>}</Stack></Modal>
    {hasNew && <Button className={styles.newMessages} size="xs" radius="xl" leftSection={<IconArrowDown size={14} />} onClick={() => { sticky.current = true; if (viewport.current) viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" }); setHasNew(false); }}>Novas mensagens</Button>}
  </div>;
});

const messageTime=new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const MessageBubble=memo(function MessageBubble({message,conversationId,senderName,canReact,onReaction,canReply,onReply,onOpenOriginal,highlighted,onChanged,clientId,clientName}:{message:Message;conversationId:string;senderName:string;canReact?:boolean;onReaction?:(conversationId:string,messageId:string,reaction:MessageReaction)=>void;onChanged?:()=>void;canReply?:boolean;onReply?:(conversationId:string,quote:QuotedMessage)=>void;onOpenOriginal:(quote:QuotedMessage)=>void;highlighted:boolean;clientId?:string|null;clientName?:string|null}){
 const [pickerOpened,setPickerOpened]=useState(false),[reacting,setReacting]=useState(false);
 const [reactionAvailable]=useState(()=>Date.now()-new Date(message.receivedAt).getTime()<=7*24*60*60*1000);
 async function react(emoji:string){
   if(reacting||!canReact)return;setPickerOpened(false);setReacting(true);
   try{const response=await fetch(`/api/whatsapp/${conversationId}/reactions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messageId:message.id,emoji})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Não foi possível reagir.");onReaction?.(conversationId,message.id,body.reaction);}catch(error){notifications.show({color:"red",message:error instanceof Error?error.message:"Não foi possível reagir."});}finally{setReacting(false);}
 }
 return <div data-message-id={message.id} data-highlighted={highlighted||undefined} className={`${styles.messageRow} ${message.direction === "OUTBOUND" ? styles.outbound : message.direction === "INTERNAL" ? styles.internal : ""}`}>
        <div className={styles.bubble}>
          {message.forwarded&&<Text size="xs" c="dimmed" mb={4}>Encaminhada</Text>}{message.deletedAt&&<Text size="xs" c="red" fw={700} mb={4}>Mensagem excluída no WhatsApp · conteúdo preservado no Hub</Text>}
          {message.editedAt&&<Text size="xs" c="dimmed" mb={4}>Editada</Text>}
          {message.replyTo&&<QuotedMessagePreview quote={message.replyTo} onOpen={()=>onOpenOriginal(message.replyTo!)}/>}
          {message.direction==="INTERNAL"&&<Text size="xs" c="yellow.8" fw={750} mb={4}>Comentário interno · somente a equipe</Text>}
          <Text size="xs" fw={800} mb={4}>{message.fromName || (message.direction === "OUTBOUND" ? "Fortuno" : senderName)}</Text>
          {message.textBody && !(message.attachments.length && /^\[(Image|Audio|Video|Sticker|Document)Message\]$/.test(message.textBody)) && <Text size="sm" className={styles.messageBody}>{message.textBody}</Text>}
          {message.attachments.map((attachment) => <AttachmentPreview key={attachment.id} conversationId={message.sourceTicketId||conversationId} attachment={attachment} transcript={message.audioTranscript} message={message.textBody || ""} />)}
          <Group justify="flex-end" gap={6} mt={5}>{message.direction === "OUTBOUND" && message.deliveryStatus && <Text size="xs" c={["failed", "unconfirmed"].includes(message.deliveryStatus) ? "red" : "dimmed"}>{message.deliveryStatus === "unconfirmed" ? "Envio não confirmado · confira antes de reenviar" : delivery[message.deliveryStatus] || message.deliveryStatus}</Text>}<Text size="xs" c="dimmed">{messageTime.format(new Date(message.receivedAt))}</Text></Group>
          {message.customerReactions?.map((reaction,index)=><span key={index} className={styles.messageReaction} title={`Reação de ${reaction.name}`}>{reaction.emoji}</span>)}
          {message.reaction?.emoji&&<span className={styles.messageReaction} title={`Reação enviada por ${message.reaction.name}`} aria-label={`Reação ${message.reaction.emoji} enviada por ${message.reaction.name}`}>{message.reaction.emoji}</span>}
        </div>
        {canReact&&message.direction!=="INTERNAL"&&!message.id.startsWith("pending:")&&<CreateFinancialEntry conversationId={conversationId} clientId={clientId} clientName={clientName} message={message}/>}
        {canReact&&message.direction!=="INTERNAL"&&!message.deletedAt&&!message.id.startsWith("pending:")&&<ForwardMessage conversationId={conversationId} messageId={message.id}/>}
        {canReact&&message.direction==="OUTBOUND"&&!message.deletedAt&&!message.id.startsWith("pending:")&&<MessageActions conversationId={conversationId} message={message} onChanged={onChanged}/>}
        {canReply&&message.direction!=="INTERNAL"&&!message.id.startsWith("pending:")&&<Tooltip label="Responder à mensagem"><ActionIcon className={styles.reactionTrigger} variant="subtle" color="gray" aria-label="Responder à mensagem" onClick={()=>onReply?.(conversationId,{id:message.id,sourceTicketId:message.sourceTicketId||conversationId,fromName:message.fromName,textBody:message.textBody?.slice(0,1000)||null,receivedAt:message.receivedAt,attachmentName:message.attachments[0]?.name||null})}><IconCornerUpLeft size={18}/></ActionIcon></Tooltip>}
        {canReact&&message.direction==="INBOUND"&&!message.id.startsWith("pending:")&&reactionAvailable&&<Popover opened={pickerOpened} onChange={setPickerOpened} position="top" withArrow shadow="md"><Popover.Target><Tooltip label="Reagir à mensagem"><ActionIcon className={styles.reactionTrigger} variant="subtle" color="gray" aria-label="Reagir à mensagem" loading={reacting} onClick={()=>setPickerOpened(value=>!value)}><IconMoodSmile size={18}/></ActionIcon></Tooltip></Popover.Target><Popover.Dropdown p="xs"><div className={styles.emojiGrid}>{REACTION_EMOJIS.map(emoji=><ActionIcon key={emoji} variant="subtle" size={32} aria-label={`Reagir com ${emoji}`} onClick={()=>void react(emoji)}><span style={{fontSize:22}}>{emoji}</span></ActionIcon>)}</div>{message.reaction?.emoji&&<Button variant="subtle" color="gray" size="compact-xs" mt="xs" fullWidth onClick={()=>void react("")}>Remover reação</Button>}</Popover.Dropdown></Popover>}
      </div>;
});
