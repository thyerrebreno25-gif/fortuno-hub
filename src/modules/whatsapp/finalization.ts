export function finalizationNote(ticketId:string,actor:{userId:string;user?:{name?:string|null;email?:string}},at:Date,phone:string|null|undefined){
 const name=actor.user?.name||actor.user?.email||"Colaborador";
 return {ticketId,direction:"INTERNAL" as const,fromName:name,fromEmail:actor.user?.email||"",toEmails:[],textBody:`Chamado finalizado em ${new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"short"}).format(at)} por ${name}.`,receivedAt:at,providerMetadata:{type:"WHATSAPP_RESOLVED",accountPhone:phone||null,finalizedById:actor.userId}};
}
