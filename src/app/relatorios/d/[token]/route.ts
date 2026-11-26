import {randomBytes} from "node:crypto";
import {readExecutiveReport} from "@/modules/management/executive-report-share";
import {executiveDashboardHtml} from "@/modules/management/executive-report-html";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
 const nonce=randomBytes(18).toString("base64url"),headers={"Content-Type":"text/html; charset=utf-8","Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow, noarchive","Permissions-Policy":"camera=(), microphone=(), geolocation=()","Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-modals`};
 try{const report=await readExecutiveReport((await params).token);if(report)return new Response(executiveDashboardHtml(report,nonce),{headers});}catch{}
 return new Response("<!doctype html><html lang=pt-BR><meta charset=utf-8><title>Relatório indisponível</title><p>Este relatório não está disponível. O link pode ter expirado ou ter sido desativado.</p></html>",{status:404,headers});
}
