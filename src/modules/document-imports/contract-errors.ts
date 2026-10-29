// Expose only validation messages, never the provider's complete response or headers.
export function contractRejection(status: number, body: unknown, fallback: string) {
  const messages: string[] = [];
  function add(value: string) {
    const text=value.replace(/https?:\/\/\S+/gi,"[endereço omitido]").replace(/<[^>]*>/g,"").trim();
    if(text && !/token|bearer|authorization|password|secret|cookie|postgres|prisma|stack trace/i.test(text)) messages.push(text.slice(0,350));
  }
  function read(value: unknown, depth=0) {
    if(depth>4 || messages.length>=8) return;
    if(typeof value==="string") {add(value);return;}
    if(Array.isArray(value)) {for(const item of value.slice(0,8)) read(item,depth+1);return;}
    if(!value || typeof value!=="object") return;
    const row=value as Record<string,unknown>;
    const field=typeof row.field==="string" ? row.field : typeof row.campo==="string" ? row.campo : "";
    if(field && /^[\w.[\]-]{1,100}$/.test(field)) add(`Campo: ${field}`);
    for(const key of ["message","mensagem","detail","detalhe","description","descricao","error","errors","erros","details","detalhes","violations"]) if(row[key]!==undefined) read(row[key],depth+1);
  }
  read(body);
  if(!messages.length && !/^[\[{]/.test(fallback.trim())) add(fallback);
  const detail=[...new Set(messages)].join(" · ");
  return `O CA rejeitou o contrato (HTTP ${status}). ${detail || "O CA não forneceu detalhes da validação."}`.slice(0,1200);
}
