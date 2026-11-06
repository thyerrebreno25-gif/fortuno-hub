import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getServiceCenterMember, getWhatsAppPermission } from "@/modules/atendimento/auth";
import { whatsappConnection } from "@/modules/whatsapp/uazapi-server";
import { decryptIntegrationSecret } from "@/modules/purchase-invoices/server/crypto";
import { object, uazapiRequest } from "@/modules/whatsapp/uazapi";
import { CURRENT_DIRECTORY_PREFIX } from "@/modules/whatsapp/directory-core";
import { contactInput } from "@/modules/whatsapp/contact-input";
import { currentWhatsAppAccount } from "@/modules/whatsapp/account-scope";
export async function GET(request:Request) {
  const member=await getServiceCenterMember();
  if(!member||member.role==="CLIENT"||!(await getWhatsAppPermission(member.organizationId,member.role)).canView)return NextResponse.json({error:"Sem permissão."},{status:403});
  const ticketId=new URL(request.url).searchParams.get("ticketId");
  if(!ticketId||ticketId.length>100)return NextResponse.json({error:"Conversa inválida."},{status:400});
  const account=await currentWhatsAppAccount(member.organizationId);
  if(!account.recipient||!account.connection?.phone)return NextResponse.json({canSave:false});
  const ticket=await prisma.serviceTicket.findFirst({where:{...account.where,id:ticketId,mergedIntoId:null},select:{senderEmail:true}});
  const number=ticket?.senderEmail.match(/^wa-contact:(\d{8,15})$/)?.[1];
  if(!number||!account.recipient||!account.connection?.phone)return NextResponse.json({canSave:false});
  const key={organizationId:member.organizationId,connectionId:account.connection.id,accountPhone:account.connection.phone};
  const saved=await prisma.whatsAppDirectoryEntry.findFirst({where:{...key,kind:"CONTACT",externalId:number+"@s.whatsapp.net",active:true,generation:{startsWith:CURRENT_DIRECTORY_PREFIX}},select:{id:true}});
  if(saved)return NextResponse.json({canSave:false},{headers:{"Cache-Control":"private, no-store"}});
  const sync=await prisma.whatsAppDirectorySync.findUnique({where:{connectionId_accountPhone:{connectionId:key.connectionId,accountPhone:key.accountPhone}},select:{status:true,generation:true}});
  return NextResponse.json({canSave:sync?.status==="COMPLETED"&&sync.generation.startsWith(CURRENT_DIRECTORY_PREFIX)},{headers:{"Cache-Control":"private, no-store"}});
}
export async function POST(request: Request) {
  const member = await getServiceCenterMember();
  if (!member || member.role === "CLIENT" || !(await getWhatsAppPermission(member.organizationId, member.role)).canEdit) return NextResponse.json({ error: "Sem permissão para salvar contatos." }, { status: 403 });
  const input = contactInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Informe o nome e o telefone completo com DDI e DDD." }, { status: 400 });
  const connection = await whatsappConnection(member.organizationId);
  if (!connection?.phone || connection.status !== "CONNECTED" || connection.expiresAt && connection.expiresAt <= new Date()) return NextResponse.json({ error: "Conecte o WhatsApp antes de salvar um contato." }, { status: 409 });
  try {
    const result = object(await uazapiRequest(connection.serverUrl, decryptIntegrationSecret(connection.tokenEncrypted), "/contact/add", input.data));
    if (result.success !== true) throw new Error("O WhatsApp não confirmou o cadastro do contato.");
    const contact = object(result.contact), expected = input.data.number + "@s.whatsapp.net";
    if (contact.jid && contact.jid !== expected) throw new Error("O WhatsApp retornou um número diferente do informado. Atualize a agenda para conferir.");
    await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WhatsAppConnection" WHERE id=${connection.id} AND "organizationId"=${member.organizationId} AND phone=${connection.phone} AND "instanceId"=${connection.instanceId} AND status='CONNECTED' FOR SHARE`;
      if (!locked.length) throw new Error("O WhatsApp conectado mudou. Atualize a agenda.");
      const sync = await tx.whatsAppDirectorySync.findUnique({ where: { connectionId_accountPhone: { connectionId: connection.id, accountPhone: connection.phone! } }, select: { generation: true } });
      const key = { connectionId: connection.id, accountPhone: connection.phone!, externalId: expected };
      await tx.whatsAppDirectoryEntry.upsert({ where: { connectionId_accountPhone_externalId: key }, create: { ...key, organizationId: member.organizationId, kind: "CONTACT", displayName: input.data.name, generation: sync?.generation || CURRENT_DIRECTORY_PREFIX + randomUUID() }, update: { displayName: input.data.name, active: true, generation: sync?.generation || CURRENT_DIRECTORY_PREFIX + randomUUID() } });
      await tx.serviceTicket.updateMany({ where: { organizationId: member.organizationId, source: "WHATSAPP_API", recipientEmail: `wa-account:${connection.id}:${connection.phone}`, senderEmail: "wa-contact:" + input.data.number }, data: { senderName: input.data.name } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível salvar o contato." }, { status: 502 });
  }
}
