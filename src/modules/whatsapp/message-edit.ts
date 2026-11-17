export const MESSAGE_EDIT_MS = 15 * 60 * 1000;
export type MessageMutation = {messageId:string;textBody?:string;editedAt?:string;deletedAt?:string};
export function messageEditProblem(message:{receivedAt:string|Date;attachments:unknown[];deliveryStatus?:string|null},now=Date.now()):string|null {
  if(message.attachments.length)return "O WhatsApp permite editar apenas mensagens de texto, sem anexos.";
  if(["failed","unconfirmed"].includes(message.deliveryStatus||""))return "O envio precisa estar confirmado antes de editar a mensagem.";
  const age=now-new Date(message.receivedAt).getTime();
  if(!Number.isFinite(age)||age<0)return "Não foi possível confirmar o horário de envio da mensagem.";
  if(age>=MESSAGE_EDIT_MS)return "O prazo de edição do WhatsApp terminou: são até 15 minutos após o envio.";
  return null;
}
export function applyMessageMutation<T extends {id:string;textBody:string|null;editedAt?:string|null;deletedAt?:string|null}>(messages:T[],update:MessageMutation):T[]{
  if(!messages.some(m=>m.id===update.messageId))return messages;
  return messages.map(m=>m.id===update.messageId?{...m,...(typeof update.textBody==="string"?{textBody:update.textBody}:{}),...(update.editedAt?{editedAt:update.editedAt}:{}),...(update.deletedAt?{deletedAt:update.deletedAt}:{})}:m);
}
