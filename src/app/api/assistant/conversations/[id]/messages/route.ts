import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { findAssistantClient, getAssistantMember } from "@/modules/assistant/auth";
import {
  inspectAssistantFile,
  uploadAssistantFileToOpenAI,
  type AssistantUploadedFile,
} from "@/modules/assistant/files";
import { OpenAIRequestError, runFortunoAssistant } from "@/modules/assistant/openai";
import { createAssistantSupportTicket } from "@/modules/assistant/tools";
import { ASSISTANT_HISTORY_MESSAGES, historyClientIds, historyUsesNotion } from "@/modules/assistant/context";
import { getRolePermissions } from "@/modules/permissions/permissions";
import type { OpenAIErrorDetails, OpenAIUsage } from "@/modules/assistant/openai-errors";
import { runInternalAssistant, type InternalAssistantResult } from "@/modules/assistant/internal-assistant";

export const maxDuration = 300;
const MAX_FILES = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

function titleFrom(prompt: string, files: File[]) {
  const source = prompt.trim() || (files[0] ? `Analisar ${files[0].name}` : "Nova conversa");
  return source.length > 58 ? `${source.slice(0, 58).trim()}…` : source;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(request: Request, context: Context) {
  const member = await getAssistantMember();
  if (!member) return NextResponse.json({ error: "Sessão inválida ou acesso não autorizado." }, { status: 401 });
  const { id } = await context.params;
  const conversation = await prisma.assistantConversation.findFirst({
    where: { id, organizationId: member.organizationId, userId: member.userId, status: "ACTIVE" },
    select: {
      id: true,
      title: true,
      clientId: true,
      client: { select: { id: true, name: true } },
      messages: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ASSISTANT_HISTORY_MESSAGES,
        select: { role: true, content: true, attachments: true, metadata: true },
      },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });
  const history = [...conversation.messages].reverse();
  if (historyUsesNotion(history) && !(await getRolePermissions(member.organizationId, member.role)).NOTION.canView) return NextResponse.json({ error: "Seu perfil não tem mais acesso ao conteúdo do Notion desta conversa." }, { status: 403 });
  // Revalidar também clientes consultados em mensagens anteriores antes de reutilizar contexto.
  const clientIds = new Set([...(conversation.clientId ? [conversation.clientId] : []), ...historyClientIds(history)]);
  for (const clientId of clientIds) {
    if (!await findAssistantClient(member, clientId)) {
      return NextResponse.json({ error: "Um cliente desta conversa não está mais disponível para seu usuário." }, { status: 403 });
    }
  }

  const form = await request.formData();
  const mode = String(form.get("mode") || "INTERNAL");
  if (!["INTERNAL", "AI"].includes(mode)) return NextResponse.json({ error: "Modo de atendimento inválido." }, { status: 400 });
  const prompt = String(form.get("message") || "").trim().slice(0, 12_000);
  const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0).slice(0, MAX_FILES);
  if (!prompt && files.length === 0) return NextResponse.json({ error: "Escreva uma mensagem ou anexe um arquivo." }, { status: 400 });
  const oversized = files.find((file) => file.size > MAX_FILE_SIZE);
  if (oversized) return NextResponse.json({ error: `${oversized.name} excede o limite de 15 MB.` }, { status: 400 });

  // Sem opção explícita de IA, nem os arquivos são enviados à OpenAI.
  const apiKey = mode === "AI" ? process.env.OPENAI_API_KEY?.trim() : undefined;
  const inspected: AssistantUploadedFile[] = [];
  const ticketCodes: string[] = [];
  let uploadError: OpenAIRequestError | null = null;
  for (const file of files) {
    const metadata = await inspectAssistantFile(file, prompt || file.name);
    if (apiKey && !uploadError) {
      try {
        metadata.openAiFileId = await uploadAssistantFileToOpenAI(file, apiKey);
      } catch (error) {
        if (error instanceof OpenAIRequestError) uploadError = error;
        metadata.analysis = {
          ...(metadata.analysis || {}),
          openAiUploadError: error instanceof Error ? error.message : "Falha ao enviar arquivo para leitura inteligente.",
        };
      }
    }
    if (metadata.unsupportedAcquirerLayout) {
      const ticket = await createAssistantSupportTicket({
        context: { member, conversationId: conversation.id },
        subject: `Novo layout de adquirente: ${file.name}`,
        description: `O Assistente Fortuno recebeu a planilha ${file.name}, mas nenhum leitor de adquirente reconheceu o layout. Solicitação do usuário: ${prompt || "analisar e configurar o arquivo"}.`,
        priority: "MEDIUM",
        module: "Adquirentes",
        clientId: conversation.clientId,
        attachments: [{ name: file.name, size: file.size, type: file.type, openAiFileId: metadata.openAiFileId || null }],
        technicalContext: { parserError: metadata.parserError, openAiFileId: metadata.openAiFileId || null },
      });
      ticketCodes.push(ticket.code);
      metadata.analysis = { ...(metadata.analysis || {}), supportTicket: ticket.code };
    }
    inspected.push(metadata);
  }

  const attachmentData = inspected.map(({ name, size, type, openAiFileId, analysis }) => ({
    name,
    size,
    type,
    ...(openAiFileId ? { openAiFileId } : {}),
    ...(analysis ? { analysis } : {}),
  }));
  const userMessage = await prisma.assistantMessage.create({
    data: {
      conversationId: conversation.id,
      role: "USER",
      content: prompt || `Analisar ${files.map((file) => file.name).join(", ")}`,
      attachments: asJson(attachmentData),
      metadata: asJson({ contextClientId: conversation.clientId }),
    },
    select: { id: true, role: true, content: true, attachments: true, metadata: true, createdAt: true },
  });

  let reply: string;
  let responseId: string | null = null;
  let toolEvents: Array<{ name: string; arguments: Record<string, unknown>; ok: boolean }> = [];
  let openAiUsage: OpenAIUsage | undefined;
  let openAiError: OpenAIErrorDetails | undefined;
  let consultedClientIds: string[] = [];
  let internalResult: InternalAssistantResult | undefined;
  try {
    // Não continuar com uploads/faturas incompletos nem insistir em uma API já bloqueada.
    if (uploadError) throw uploadError;
    if (!apiKey) {
      internalResult = await runInternalAssistant({ context: { member, conversationId: conversation.id }, prompt,
        client: conversation.client, files: inspected, ticketCodes });
      reply = (mode === "AI" ? "A IA externa não está configurada. Atendi pelo modo interno.\n\n" : "") + internalResult.text;
      toolEvents = internalResult.toolEvents;
      consultedClientIds = internalResult.consultedClientIds;
    } else {
      const result = await runFortunoAssistant({
        context: { member, conversationId: conversation.id },
        prompt: [prompt, ticketCodes.length ? `Chamados criados automaticamente: ${ticketCodes.join(", ")}.` : ""].filter(Boolean).join("\n"),
        client: conversation.client,
        files: inspected,
        history,
      });
      reply = result.text;
      responseId = result.responseId;
      toolEvents = result.toolEvents;
      openAiUsage = result.usage;
      consultedClientIds = result.consultedClientIds;
    }
  } catch (error) {
    reply = error instanceof OpenAIRequestError ? error.message : `Não consegui concluir a resposta inteligente agora: ${error instanceof Error ? error.message : "falha inesperada"}.`;
    if (error instanceof OpenAIRequestError) {
      openAiError = error.details;
      openAiUsage = error.usage;
      console.warn("assistant_openai_error", { ...error.details, ...(error.usage ? { usage: error.usage } : {}) });
    }
    if (ticketCodes.length) reply += ` O chamado ${ticketCodes.join(", ")} foi criado normalmente.`;
  }

  const assistantMessage = await prisma.$transaction(async (transaction) => {
    const message = await transaction.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: reply,
        metadata: asJson({ responseId, ticketCodes, toolEvents, contextClientId: conversation.clientId,
          consultedClientIds, executionMode: internalResult ? "INTERNAL" : "AI",
          ...(internalResult ? { internalLinks: internalResult.links, ...(internalResult.reportTitle ? { reportTitle: internalResult.reportTitle } : {}) } : {}),
          ...(openAiUsage ? { openAiUsage } : {}), ...(openAiError ? { openAiError } : {}) }),
      },
      select: { id: true, role: true, content: true, attachments: true, metadata: true, createdAt: true },
    });
    await transaction.assistantConversation.update({
      where: { id: conversation.id },
      data: {
        ...(conversation.title === "Nova conversa" ? { title: titleFrom(prompt, files) } : {}),
        lastOpenAiResponseId: responseId,
      },
    });
    return message;
  });

  return NextResponse.json({ userMessage, assistantMessage, ticketCodes });
}
