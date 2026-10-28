import { NextResponse } from "next/server";
// The WhatsApp module now uses the per-organization Uazapi endpoint.
export async function GET() {
  return NextResponse.json({ error: "Integração Meta desativada. Configure a conexão Uazapi no Hub." }, { status: 410 });
}
export async function POST() {
  return NextResponse.json({ error: "Integração Meta desativada." }, { status: 410 });
}
