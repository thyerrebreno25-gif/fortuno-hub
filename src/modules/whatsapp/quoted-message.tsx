"use client";
import {Text} from "@mantine/core";
import type {QuotedMessage} from "./quote-core";
import styles from "@/app/(platform)/whatsapp/whatsapp.module.css";
export function QuotedMessagePreview({quote,onOpen}:{quote:QuotedMessage;onOpen?:()=>void}){
 const content=<><Text size="xs" fw={750}>{quote.fromName||"Mensagem original"}{quote.receivedAt&&<span className={styles.quoteDate}> · {new Date(quote.receivedAt).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>}</Text><Text size="sm" lineClamp={2} style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{quote.textBody||quote.attachmentName||"Mensagem citada · toque para consultar"}</Text>{quote.attachmentName&&quote.textBody&&<Text size="xs" c="dimmed">📎 {quote.attachmentName}</Text>}</>;
 return onOpen?<button type="button" className={styles.quotedMessage} aria-label="Ver mensagem citada" onClick={onOpen}>{content}</button>:<div className={styles.quotedMessage}>{content}</div>;
}
