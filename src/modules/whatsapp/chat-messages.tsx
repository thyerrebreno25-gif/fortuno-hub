"use client";
import { Button, Group, Image, Modal, Text } from "@mantine/core";
import { IconArrowDown, IconDownload } from "@tabler/icons-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { mediaKind } from "./media";
import styles from "@/app/(platform)/whatsapp/whatsapp.module.css";
type Attachment = { id: string; name: string; mimeType: string | null };
type Message = { id: string; direction: "INBOUND" | "OUTBOUND" | "INTERNAL"; fromName: string | null; textBody: string | null; receivedAt: string; deliveryStatus: string | null; attachments: Attachment[] };
const delivery: Record<string, string> = { accepted: "Enviando", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falha no envio" };
function AttachmentPreview({ conversationId, attachment, message }: { conversationId: string; attachment: Attachment; message: string }) {
  const [opened, setOpened] = useState(false), [failed, setFailed] = useState(false);
  const src = `/api/whatsapp/${conversationId}/attachments/${attachment.id}`;
  const preview = src + "?preview=1";
  const kind = mediaKind(attachment.mimeType, attachment.name, message);
  return <div className={styles.attachment}>
    {!failed && kind === "image" && <><button type="button" className={styles.imageButton} onClick={() => setOpened(true)} aria-label="Ampliar imagem"><Image loading="lazy" decoding="async" src={preview} alt="Imagem da mensagem" fit="contain" className={styles.chatImage} onError={() => setFailed(true)} /></button><Modal opened={opened} onClose={() => setOpened(false)} title="Imagem da mensagem" size="xl" centered><Image src={preview} alt="Imagem ampliada da mensagem" fit="contain" mah="75vh" /></Modal></>}
    {!failed && kind === "audio" && <audio controls preload="none" src={preview} className={styles.chatAudio} onError={() => setFailed(true)}>Seu navegador não suporta áudio.</audio>}
    {!failed && kind === "video" && <video controls preload="metadata" src={preview} className={styles.chatVideo} onError={() => setFailed(true)}><track kind="captions" />Seu navegador não suporta vídeo.</video>}
    {failed && <Text size="xs" c="red">Não foi possível carregar a prévia. Tente baixar o arquivo.</Text>}
    <Button component="a" href={src} target="_blank" rel="noreferrer" size="compact-xs" variant="subtle" color="gray" leftSection={<IconDownload size={13} />}>{kind === "file" ? attachment.name : kind === "audio" ? "Baixar áudio" : kind === "video" ? "Baixar vídeo" : "Baixar imagem"}</Button>
  </div>;
}
export const ChatMessages = memo(function ChatMessages({ conversationId, messages, senderName, hasOlder, loadingOlder, onLoadOlder }: { conversationId: string; messages: Message[]; senderName: string; hasOlder?: boolean; loadingOlder?: boolean; onLoadOlder?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const firstMessageId = messages[0]?.id;
  const prepend = useRef<{id:string;top:number;height:number}|null>(null);
  useLayoutEffect(() => { const saved = prepend.current; const node = viewport.current; if (saved && node && saved.id === conversationId) node.scrollTop = saved.top + node.scrollHeight - saved.height; prepend.current = null; }, [conversationId, firstMessageId]);
  const sticky = useRef(true), previous = useRef({ conversationId: "", lastId: "" });
  const [hasNew, setHasNew] = useState(false);
  const last = messages.at(-1);
  useEffect(() => {
    const switched = previous.current.conversationId !== conversationId;
    const changed = previous.current.lastId !== (last?.id || "");
    previous.current = { conversationId, lastId: last?.id || "" };
    if (!switched && !changed) return;
    const frame = requestAnimationFrame(() => {
      if (switched || sticky.current || last?.direction === "OUTBOUND") {
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
  return <div className={styles.messagesFrame}>
    <div ref={viewport} className={styles.messages} role="log" aria-label="Mensagens da conversa" onScroll={() => { const el = viewport.current; if (!el) return; sticky.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90; if (sticky.current) setHasNew(false); }}>
      <div ref={content}>{hasOlder && <Group justify="center" py="sm"><Button variant="light" size="xs" loading={loadingOlder} onClick={() => { sticky.current = false; if (viewport.current) prepend.current = {id:conversationId,top:viewport.current.scrollTop,height:viewport.current.scrollHeight}; onLoadOlder?.(); }}>Carregar mensagens anteriores</Button></Group>}{messages.map((message) => <div key={message.id} className={`${styles.messageRow} ${message.direction === "OUTBOUND" ? styles.outbound : message.direction === "INTERNAL" ? styles.internal : ""}`}>
        <div className={styles.bubble}>
          <Text size="xs" fw={800} mb={4}>{message.fromName || (message.direction === "OUTBOUND" ? "Fortuno" : senderName)}</Text>
          {message.textBody && !(message.attachments.length && /^\[(Image|Audio|Video|Sticker|Document)Message\]$/.test(message.textBody)) && <Text size="sm" className={styles.messageBody}>{message.textBody}</Text>}
          {message.attachments.map((attachment) => <AttachmentPreview key={attachment.id} conversationId={conversationId} attachment={attachment} message={message.textBody || ""} />)}
          <Group justify="flex-end" gap={6} mt={5}>{message.direction === "OUTBOUND" && message.deliveryStatus && <Text size="xs" c={message.deliveryStatus === "failed" ? "red" : "dimmed"}>{delivery[message.deliveryStatus] || message.deliveryStatus}</Text>}<Text size="xs" c="dimmed">{new Date(message.receivedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</Text></Group>
        </div>
      </div>)}</div>
    </div>
    {hasNew && <Button className={styles.newMessages} size="xs" radius="xl" leftSection={<IconArrowDown size={14} />} onClick={() => { sticky.current = true; if (viewport.current) viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" }); setHasNew(false); }}>Novas mensagens</Button>}
  </div>;
});
