const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function detectPaymentRequest(body:string,files:string[]=[]){
 const text=normalize(body),names=normalize(files.join(" "));
 if(/(?:pagamento|pix|boleto|transferencia).{0,25}(?:efetuad|realizad|concluid|recebid)|(?:ja|foi|esta)\s+pag[oa]|nao.{0,12}(?:pagar|pagamento)/.test(text))return null;
 const payment=/\b(?:pagar|pague|paga|pagamento|pagamentos|pix|boleto|transferencia|transferir|quitacao)\b/.test(text);
 const action=/\b(?:favor|preciso|precisamos|solicito|solicitacao|podem|pode|poderia|providenciar|agendar|vence|vencimento|segue|realizar|fazer|hoje|amanha|pagar|pague|paga|transferir|transfere)\b/.test(text);
 const amount=/r\$\s*\d|\b\d[\d.]*,\d{2}\b/.test(text);
 if(/boleto/.test(names)||payment&&(action||amount))return "Possível solicitação de pagamento: confira o pedido e os dados antes de lançar.";
 return null;
}
export function paymentDraft(text:string){
 const amountMatch=text.match(/(?:valor(?:\s+(?:do documento|total|a pagar))?\s*[:=]?\s*|R\$\s*)([\d.]+,\d{2})/i);
 const amount=amountMatch?Number(amountMatch[1].replace(/\./g,"").replace(",",".")):null;
 const due=text.match(/(?:vencimento|venc(?:er|e|\.)?)\s*[:=]?\s*(\d{2})[/-](\d{2})[/-](\d{4})/i);
 const dueDate=due?`${due[3]}-${due[2]}-${due[1]}`:"";
 const counterparty=text.match(/(?:benefici[aá]rio|favorecido|fornecedor)\s*[:=]\s*([^\n]{2,150})/i)?.[1]?.trim()||"";
 return {amount:amount&&Number.isFinite(amount)&&amount>0?amount:null,dueDate,counterparty,description:text.replace(/\s+/g," ").slice(0,180),observation:text.slice(0,1700)};
}
