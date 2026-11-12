import {repairCallPlaceholders} from "@/modules/whatsapp/uazapi-events";
import {reopenWhatsAppCall,ReopenWhatsAppError} from "@/modules/whatsapp/reopen";
import {findReplyTarget,ReplyTargetError} from "@/modules/whatsapp/reply-target";
import {readWhatsAppConversation,ConversationCursorError} from "@/modules/whatsapp/conversation-read";
import {currentWhatsAppAccount} from "@/modules/whatsapp/account-scope";
import {outgoingContext} from "@/modules/whatsapp/outgoing-context";
import { signedWhatsappText } from "@/modules/whatsapp/operator-signature";
import {isContactName} from "@/modules/whatsapp/contact-name";
import {resolvedChatProfile,rememberChatName} from "@/modules/whatsapp/contact-profile";
import { after, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getServiceCenterMember,
  getWhatsAppPermission,
  SERVICE_CENTER_MANAGER_ROLES,
} from "@/modules/atendimento/auth";
import {
  parseWhatsappChannelAddress,
  type WhatsAppRoutingArea,
} from "@/modules/whatsapp/core";
import { whatsappConnection, sendUazapiText } from "@/modules/whatsapp/uazapi-server";
import { object } from "@/modules/whatsapp/uazapi";
import { eligibleWhatsappResponsible, getWhatsappTicket, resolveWhatsappTicketId } from "@/modules/whatsapp/server";
import { chatLock } from "@/modules/whatsapp/merge";
import { transferWhatsappTicket, WhatsAppTransferError } from "@/modules/whatsapp/transfer";

type Context = { params: Promise<{ id: string }> };

const VALID_AREAS = new Set([
  "ACCOUNTS_PAYABLE",
  "ACCOUNTS_RECEIVABLE",
  "GENERAL",
  "UNKNOWN",
]);

export async function GET(_request: Request, context: Context) {
  const member = await getServiceCenterMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const [permission,account]=await Promise.all([getWhatsAppPermission(member.organizationId,member.role),currentWhatsAppAccount(member.organizationId)]);
  if(!permission.canView||member.role==="CLIENT")return NextResponse.json({error:"Sem permissão."},{status:403});
  const {id}=await context.params,beforeId=new URL(_request.url).searchParams.get("before")||undefined;
  if(id.length>100||(beforeId?.length||0)>100)return NextResponse.json({error:"Conversa inválida."},{status:400});
  try{
    const ticket=await readWhatsAppConversation(id,member.organizationId,beforeId,account);
    if(ticket && !beforeId && account.connection){
      const needsName=!isContactName(ticket.senderName||ticket.subject);
      const needsCallRepair=ticket.messages.some(message=>message.textBody==="[Mensagem sem texto]");
      if(needsName||needsCallRepair)after(async()=>{
        const connection=await whatsappConnection(member.organizationId);
        if(!connection||connection.status!=="CONNECTED"||`wa-account:${connection.id}:${connection.phone}`!==account.recipient)return;
        if(needsName)try{const channel=parseWhatsappChannelAddress(ticket.senderEmail),profile=await resolvedChatProfile(connection,channel.externalId,channel.kind==="GROUP");await rememberChatName(connection,ticket.senderEmail,profile.name);}catch{/* Keep message loading independent of profile lookup. */}
        if(needsCallRepair)try{await repairCallPlaceholders(connection,ticket.id);}catch{/* Retry through a later read without blocking the conversation. */}
      });
    }
    return ticket?NextResponse.json({ticket},{headers:{"Cache-Control":"private, no-store"}}):NextResponse.json({error:"Atendimento não encontrado."},{status:404});
  }catch(error){if(error instanceof ConversationCursorError)return NextResponse.json({error:error.message},{status:400});throw error;}
}

export async function PATCH(request: Request, context: Context) {
  const member = await getServiceCenterMember();
  if (!member) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  const permission = await getWhatsAppPermission(
    member.organizationId,
    member.role,
  );
  if (!permission.canEdit || member.role === "CLIENT") {
    return NextResponse.json({ error: "Sem permissão." }, { status: 403 });
  }

  const { id: requestedId } = await context.params;
  const current = await getWhatsappTicket(requestedId, member.organizationId, {});
  if (!current) {
    return NextResponse.json(
      { error: "Atendimento não encontrado." },
      { status: 404 },
    );
  }

  const id = current.id;
  const body = (await request.json()) as Record<string, unknown>;
  const action = String(body.action || "");
  const canManage =
    permission.canManage || SERVICE_CENTER_MANAGER_ROLES.has(member.role);
  const occupiedByAnother =
    current.assignedToId && current.assignedToId !== member.userId;

  if(action==="reopen"){
    try{const openedId=await reopenWhatsAppCall(current,member.userId);return NextResponse.json({ticket:await readWhatsAppConversation(openedId,member.organizationId)});}
    catch(error){return NextResponse.json({error:error instanceof ReopenWhatsAppError?error.message:"Não foi possível abrir o chamado."},{status:error instanceof ReopenWhatsAppError?error.status:500});}
  }

  if (action === "transfer") {
    try { await transferWhatsappTicket(current, member, canManage, body); }
    catch (error) {
      return NextResponse.json({ error: error instanceof WhatsAppTransferError ? error.message : "Não foi possível transferir o atendimento." }, { status: error instanceof WhatsAppTransferError ? error.status : 500 });
    }
  } else if (action === "assign") {
    if (occupiedByAnother && !canManage) return NextResponse.json({ error: "Este atendimento está com outro operador." }, { status: 403 });
    if (["RESOLVED", "SPAM"].includes(current.status)) return NextResponse.json({ error: "Este atendimento já foi finalizado." }, { status: 400 });
    let assignedToId =
      typeof body.assignedToId === "string" && body.assignedToId
        ? body.assignedToId
        : member.userId;

    if (!canManage) assignedToId = member.userId;

    const membership = await prisma.organizationMember.findFirst({
      where: { organizationId: member.organizationId, userId: assignedToId },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json(
        { error: "Colaborador inválido." },
        { status: 400 },
      );
    }

    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id, mergedIntoId: null },
        data: {
          assignedToId,
          assignedAt: new Date(),
          routingReason: "Atendimento assumido ou atribuído manualmente.",
          status: current.status === "NEW" ? "IN_PROGRESS" : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_ASSIGNED",
          message:
            assignedToId === member.userId
              ? "Atendimento assumido pelo colaborador."
              : "Atendimento direcionado a outro colaborador.",
          metadata: { assignedToId },
        },
      }),
    ]);
  } else if (action === "client") {
    const clientId = String(body.clientId || "");
    if (!clientId) {
      return NextResponse.json(
        { error: "Selecione um cliente." },
        { status: 400 },
      );
    }

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: member.organizationId, active: true },
      select: {
        id: true,
        serviceSquad: true,
        operationLeaderId: true,
        payableResponsibleId: true,
        receivableResponsibleId: true,
        generalResponsibleId: true,
      },
    });
    if (!client) {
      return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
    }

    const channel = parseWhatsappChannelAddress(current.senderEmail);
    const automaticAssignee = await eligibleWhatsappResponsible(
      member.organizationId,
      client,
      current.routingArea,
    );
    const assignedToId = current.assignedToId || automaticAssignee;

    await prisma.$transaction([
      prisma.clientWhatsAppIdentity.upsert({
        where: {
          organizationId_clientId_kind_externalId: {
            organizationId: member.organizationId,
            clientId,
            kind: channel.kind,
            externalId: channel.externalId,
          },
        },
        create: {
          organizationId: member.organizationId,
          clientId,
          kind: channel.kind,
          externalId: channel.externalId,
          displayName: current.senderName,
        },
        update: { active: true, displayName: current.senderName },
      }),
      prisma.serviceTicket.update({
        where: { id, mergedIntoId: null },
        data: {
          clientId,
          routingSquad: client.serviceSquad,
          routingReason: "Cliente vinculado manualmente ao WhatsApp.",
          routingConfidence: 100,
          assignedToId,
          assignedAt: assignedToId ? current.assignedAt || new Date() : null,
          status: assignedToId && current.status === "NEW" ? "IN_PROGRESS" : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_CLIENT_LINKED",
          message: "Contato do WhatsApp vinculado ao cliente.",
          metadata: { clientId, channel },
        },
      }),
    ]);
  } else if (action === "routingArea") {
    const requestedArea = String(body.routingArea || "UNKNOWN");
    if (!VALID_AREAS.has(requestedArea)) {
      return NextResponse.json({ error: "Área inválida." }, { status: 400 });
    }
    const routingArea = requestedArea as WhatsAppRoutingArea;
    let automaticAssignee: string | null = null;

    if (current.clientId) {
      const client = await prisma.client.findUnique({
        where: { id: current.clientId },
        select: {
          operationLeaderId: true,
          payableResponsibleId: true,
          receivableResponsibleId: true,
          generalResponsibleId: true,
        },
      });
      if (client) automaticAssignee = await eligibleWhatsappResponsible(member.organizationId, client, routingArea);
    }

    const assignedToId = current.assignedToId || automaticAssignee;
    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id, mergedIntoId: null },
        data: {
          routingArea,whatsappDepartmentId:null,whatsappDepartmentName:null,
          routingReason: "Área do atendimento selecionada manualmente.",
          assignedToId,
          assignedAt: assignedToId ? current.assignedAt || new Date() : null,
          status: assignedToId && current.status === "NEW" ? "IN_PROGRESS" : current.status,
        },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_AREA_CHANGED",
          message: "Área do atendimento atualizada.",
          metadata: { routingArea, automaticAssignee },
        },
      }),
    ]);
  } else if (action === "comment") {
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content || content.length > 5000) return NextResponse.json({ error: "Escreva um comentário de até 5.000 caracteres." }, { status: 400 });
    // INTERNAL messages never pass through the external provider or count as a customer reply.
    await prisma.$transaction(async tx => {
      const currentId = await resolveWhatsappTicketId(id, member.organizationId, tx);
      const now = new Date();
      await tx.serviceMessage.create({ data: { ticketId: currentId, direction: "INTERNAL", fromName: member.user.name || member.user.email, fromEmail: member.user.email, toEmails: [], textBody: content, receivedAt: now, providerMetadata: { type: "WHATSAPP_COMMENT", accountPhone: current.recipientEmail?.split(":").at(-1) || null, userId: member.userId } } });
      await tx.serviceTicket.update({ where: { id: currentId, mergedIntoId: null }, data: { updatedAt: now } });
      await tx.serviceTicketHistory.create({ data: { ticketId: currentId, userId: member.userId, type: "WHATSAPP_COMMENTED", message: "Comentário interno adicionado à conversa." } });
    });
  } else if (action === "reply") {
    if (current.assignedToId !== member.userId) {
      return NextResponse.json(
        { error: "Assuma este chamado antes de enviar mensagens ao cliente. Comentários internos continuam disponíveis." },
        { status: 403 },
      );
    }
    const content = String(body.content || "").trim();
    if (!content) {
      return NextResponse.json({ error: "Escreva uma resposta." }, { status: 400 });
    }
    if (current.status === "RESOLVED") {
      return NextResponse.json(
        { error: "O atendimento foi finalizado. Aguarde uma nova mensagem do cliente." },
        { status: 400 },
      );
    }

    let replyTarget:Awaited<ReturnType<typeof findReplyTarget>>|null=null;
    if(body.replyToMessageId!==undefined&&body.replyToMessageId!==null){
      try{replyTarget=await findReplyTarget(current,body.replyToMessageId);if(!replyTarget.providerId)throw new ReplyTargetError("Esta mensagem não está disponível para responder pelo WhatsApp.");}
      catch(error){return NextResponse.json({error:error instanceof ReplyTargetError?error.message:"Não foi possível validar a mensagem original."},{status:error instanceof ReplyTargetError?error.status:500});}
    }
    let externalMessageId: string | null = null;
    let providerMetadata: { provider: string; instanceId: string; connectionId: string; accountPhone: string | null;replyToMessageId?:string } | undefined;
    if (current.source === "WHATSAPP_API") {
      const latestInbound = [...current.messages]
        .reverse()
        .find((message) => message.direction === "INBOUND");
      try {
        const metadata = object(latestInbound?.providerMetadata);
        const connection = await whatsappConnection(member.organizationId);
        const destination = outgoingContext(current.recipientEmail, current.senderEmail, connection, metadata);
        const sent = await sendUazapiText({ accountRecipient: current.recipientEmail,organizationId:member.organizationId,body:signedWhatsappText(member.user.name, content),...destination,replyToMessageId:replyTarget?.providerId});
        externalMessageId = sent.messageId;
        providerMetadata = { provider: "UAZAPI", instanceId: sent.instanceId, connectionId: sent.connectionId, accountPhone: sent.accountPhone,...(replyTarget?{replyToMessageId:replyTarget.quote.id!}:{}) };
      } catch (error) {
        console.error("Falha ao enviar resposta pelo WhatsApp:", error);
        return NextResponse.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Não foi possível enviar a mensagem pelo WhatsApp.",
          },
          { status: 502 },
        );
      }
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (providerMetadata) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chatLock(providerMetadata.connectionId, current.senderEmail)}))`;
      const currentId = await resolveWhatsappTicketId(id, member.organizationId, tx);
      const active = await tx.serviceTicket.findFirst({ where: { id: currentId, organizationId: member.organizationId } });
      const assignedToId = active?.assignedToId || current.assignedToId || member.userId;
      await tx.serviceMessage.create({
        data: {
          ticketId: currentId,
          externalMessageId,
          deliveryStatus: externalMessageId ? "accepted" : null,
          statusUpdatedAt: externalMessageId ? now : null,
          providerMetadata,
          direction: "OUTBOUND",
          fromName: member.user.name || member.user.email,
          fromEmail: member.user.email,
          toEmails: [current.senderEmail],
          textBody: content,
          receivedAt: now,
        },
      });
      await tx.serviceTicket.update({
        where: { id: currentId, mergedIntoId: null },
        data: {
          assignedToId,
          assignedAt: active?.assignedAt || current.assignedAt || now,
          firstResponseAt: active?.firstResponseAt || current.firstResponseAt || now,
          lastMessageAt: now,
          snippet: content.slice(0, 220),
          status: "IN_PROGRESS",
        },
      });
      await tx.serviceTicketHistory.create({
        data: {
          ticketId: currentId,
          userId: member.userId,
          type: "WHATSAPP_REPLIED",
          message:
            current.source === "WHATSAPP_API"
              ? "Resposta enviada pelo WhatsApp."
              : "Resposta registrada no ambiente de teste.",
          metadata: externalMessageId ? { externalMessageId } : undefined,
        },
      });
    });
  } else if (action === "finalize") {
    if (current.status === "RESOLVED") return NextResponse.json({ticket:current});
    if (occupiedByAnother && !canManage) {
      return NextResponse.json(
        { error: "Este atendimento está com outro colaborador." },
        { status: 403 },
      );
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.serviceTicket.update({
        where: { id, mergedIntoId: null },
        data: { status: "RESOLVED", resolvedAt: now },
      }),
      prisma.serviceTicketHistory.create({
        data: {
          ticketId: id,
          userId: member.userId,
          type: "WHATSAPP_RESOLVED",
          message: "Atendimento finalizado.",
        },
      }),
    ]);
  } else if (action === "satisfaction") {
    return NextResponse.json({error:"A satisfação é registrada pelo cliente no link da pesquisa."},{status:410});
  } else {
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }

  return NextResponse.json({
    ticket: await readWhatsAppConversation(id, member.organizationId),
  });
}
