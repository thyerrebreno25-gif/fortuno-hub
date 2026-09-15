import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { findAssistantClient, getAssistantMember } from "@/modules/assistant/auth";
import {
  inspectAssistantFile,
  uploadAssistantFileToOpenAI,
  type AssistantUploadedFile,
} from "@/modules/assistant/files";
import { runFortunoAssistant } from "@/modules/assistant/openai";
import { createAssistantSupportTicket } from "@/modules/assistant/tools";

export const maxDuration = 300;
const MAX_FILES = 5;
const MAX_FILE_SIZE = 15 * 1024 * 1024;

type Context = { params: Promise<{ id: string }> };

function titleFrom(prompt: string, files: File[]) {
  const source = prompt.trim() || (files[0] ? `Analisar ${files[0].name}` : "Nova conversa");
  return source.length > 58 ? `${source.slice(0, 58).trim()}…` : source;
}

function deterministicReply(files: AssistantUploadedFile[], ticketCodes: string[]) {
  if (ticketCodes.length) {
    return `O layout enviado ainda não está configurado. Criei automaticamente ${ticketCodes.length === 1 ? "o chamado" : "os chamados"} ${ticketCodes.join(", ")} para o suporte analisar e adicionar o novo leitor.`;
  }
  const analyses = files.filter((file) => file.analysis);
  if (analyses.length) {
    return `A leitura determinística dos arquivos foi concluída, mas a inteligência do assistente ainda não está configurada. ${analyses.map((file) => `${file.name}: ${JSON.stringify(file.analysis)}`).join(" ")}`;
  }
  return "O Assistente Fortuno ainda não está conectado à OpenAI. Configure OPENAI_API_KEY no ambiente para habilitar respostas e consultas inteligentes.";
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
      lastOpenAiResponseId: true,
      client: { select: { id: true, name: true } },
    },
  });
  if (!conversation) return NextResponse.json({ error: "Conversa não encontrada." }, { status: 404 });

  const form = await request.formData();
  const prompt = String(form.get("message") || "").trim().slice(0, 12_000);
  const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0).slice(0, MAX_FILES);
  if (!prompt && files.length === 0) return NextResponse.json({ error: "Escreva uma mensagem ou anexe um arquivo." }, { status: 400 });
  const oversized = files.find((file) => file.size > MAX_FILE_SIZE);
  if (oversized) return NextResponse.json({ error: `${oversized.name} excede o limite de 15 MB.` }, { status: 400 });

  if (conversation.clientId && !await findAssistantClient(member, conversation.clientId)) {
    return NextResponse.json({ error: "O cliente desta conversa não está mais disponível para seu usuário." }, { status: 403 });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const inspected: AssistantUploadedFile[] = [];
  const ticketCodes: string[] = [];
  for (const file of files) {
    const metadata = await inspectAssistantFile(file, prompt || file.name);
    if (apiKey) {
      try {
        metadata.openAiFileId = await uploadAssistantFileToOpenAI(file, apiKey);
      } catch (error) {
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
    },
    select: { id: true, role: true, content: true, attachments: true, metadata: true, createdAt: true },
  });

  let reply: string;
  let responseId: string | null = null;
  let toolEvents: Array<{ name: string; arguments: Record<string, unknown>; ok: boolean }> = [];
  try {
    if (!apiKey) {
      reply = deterministicReply(inspected, ticketCodes);
    } else {
      const result = await runFortunoAssistant({
        context: { member, conversationId: conversation.id },
        prompt: [prompt, ticketCodes.length ? `Chamados criados automaticamente: ${ticketCodes.join(", ")}.` : ""].filter(Boolean).join("\n"),
        client: conversation.client,
        files: inspected,
        previousResponseId: conversation.lastOpenAiResponseId,
      });
      reply = result.text;
      responseId = result.responseId;
      toolEvents = result.toolEvents;
    }
  } catch (error) {
    reply = `Não consegui concluir a resposta inteligente agora: ${error instanceof Error ? error.message : "falha inesperada"}. ${ticketCodes.length ? `O chamado ${ticketCodes.join(", ")} foi criado normalmente.` : "Tente novamente em instantes."}`;
  }

  const assistantMessage = await prisma.$transaction(async (transaction) => {
    const message = await transaction.assistantMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: reply,
        metadata: asJson({ responseId, ticketCodes, toolEvents }),
      },
      select: { id: true, role: true, content: true, attachments: true, metadata: true, createdAt: true },
    });
    await transaction.assistantConversation.update({
      where: { id: conversation.id },
      data: {
        ...(conversation.title === "Nova conversa" ? { title: titleFrom(prompt, files) } : {}),
        ...(responseId ? { lastOpenAiResponseId: responseId } : {}),
      },
    });
    return message;
  });

  return NextResponse.json({ userMessage, assistantMessage, ticketCodes });
}
