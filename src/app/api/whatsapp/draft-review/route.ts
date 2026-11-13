import { NextResponse } from "next/server";
// Retire remote review for already-open clients as well. Never read the draft,
// query a database, charge a model or forward this legacy request anywhere.
export async function POST() {
  return NextResponse.json({ error: "Atualize a página para usar o revisor automático local, sem IA externa." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
