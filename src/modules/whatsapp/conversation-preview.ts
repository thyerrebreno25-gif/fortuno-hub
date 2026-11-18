import type { ConversationSnapshot } from "./conversation-read";
import { callLabel } from "./call-core";

export function conversationPreview(ticket: ConversationSnapshot) {
  return {
    id: ticket.id,
    contact: ticket.senderName || ticket.subject,
    status: ticket.status,
    updatedAt: ticket.updatedAt,
    messages: ticket.messages.slice(-8).map(message => ({
      id: message.id,
      direction: message.direction,
      author: message.fromName || (message.direction === "INBOUND" ? ticket.senderName || ticket.subject : "Equipe"),
      body: (message.call ? callLabel(message.call, message.direction === "OUTBOUND") : message.textBody || (message.attachments.length ? "Anexo" : "Mensagem sem texto")).slice(0, 1200),
      at: message.receivedAt,
      deleted: Boolean(message.deletedAt),
      attachments: message.attachments.slice(0, 5).map(attachment => ({ name: attachment.name, mimeType: attachment.mimeType })),
    })),
  };
}
export type ConversationPreview = ReturnType<typeof conversationPreview>;
