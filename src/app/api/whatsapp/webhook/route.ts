import { NextResponse } from "next/server";
import {
  getWhatsAppVerifyToken,
  isValidMetaSignature,
  type MetaWhatsAppWebhookPayload,
} from "@/modules/whatsapp/meta";
import { processWhatsAppWebhook } from "@/modules/whatsapp/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  try {
    if (
      mode === "subscribe" &&
      verifyToken === getWhatsAppVerifyToken() &&
      challenge
    ) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  } catch (error) {
    console.error("Webhook WhatsApp sem configuração:", error);
    return NextResponse.json(
      { error: "Webhook do WhatsApp ainda não configurado." },
      { status: 503 },
    );
  }

  return NextResponse.json({ error: "Verificação inválida." }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!isValidMetaSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload: MetaWhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWhatsAppWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  try {
    const result = await processWhatsAppWebhook(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha ao processar webhook do WhatsApp:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível processar a mensagem.",
      },
      { status: 500 },
    );
  }
}
