import type { PdfTextLine } from "../pdf-reader.client";
import type { ParsedInvoice, ParsedInvoiceItem } from "../types";

const MONTHS: Record<string, number> = {jan:1,fev:2,mar:3,abr:4,mai:5,jun:6,jul:7,ago:8,set:9,out:10,nov:11,dez:12};
const compact=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f\s]/g,"");
const money=(value:string)=>Math.round(Number(value.replace(/\./g,"").replace(",","."))*100);
const format=(cents:number)=>(cents/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
function readable(value:string){
  const words=value.trim().split(/\s+/);
  // This PDF encodes letter spacing inside each word. Keep the word boundaries
  // supplied by PDF.js text fragments instead of removing spaces from the row.
  return words.length>2 && words.filter(word=>word.length<=2).length/words.length>.7 ? value.replace(/\s/g,"") : value.trim();
}
function transactionDate(day:number,month:number,dueDate:string,installment?:string){
  const [dueYear,dueMonth]=dueDate.split("-").map(Number);
  const latestMonth=new Date(Date.UTC(dueYear,dueMonth-1-(Number(installment?.split("/")[0]||1)-1),1));
  let year=latestMonth.getUTCFullYear();
  if(month>latestMonth.getUTCMonth()+1)year--;
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
  if(date.toISOString().slice(0,10)>dueDate)year--;
  return String(year).padStart(4,"0")+"-"+String(month).padStart(2,"0")+"-"+String(day).padStart(2,"0");
}

export function parseUnicredInvoice(source:PdfTextLine[]):ParsedInvoice{
  const texts=source.map(line=>compact(line.text));
  const due=texts.map(text=>text.match(/VENCIMENTO:(\d{2})(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(20\d{2})/i)).find(Boolean);
  if(!due)throw new Error("Não foi possível identificar o vencimento da fatura Unicred. Envie o PDF completo.");
  const dueDate=due[3]+"-"+String(MONTHS[due[2].toLowerCase()]).padStart(2,"0")+"-"+due[1];
  const total=texts.map(text=>text.match(/(?:VALORTOTALDE|^TOTAL:)R\$([\d.]+,\d{2})/i)).find(Boolean);
  const invoiceCents=total?money(total[1]):null;
  const items:ParsedInvoiceItem[]=[],warnings:string[]=[];
  let active=false,page=0,cardLastDigits:string|undefined;
  for(let i=0;i<source.length;i++){
    const line=source[i],text=texts[i];
    if(line.page!==page){page=line.page;active=false;cardLastDigits=undefined;}
    if(/^LANCAMENTOS[–—-]/i.test(text)){active=true;cardLastDigits=text.match(/[*.]+(\d{4})$/)?.[1];continue;}
    if(/^TOTALDE/i.test(text)){active=false;continue;}
    if(!active)continue;
    const date=text.match(/^(\d{2})\/(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i);
    const amount=text.match(/(-?)R\$([\d.]+,\d{2})$/);
    if(!date||!amount)continue;
    const cents=money(amount[2])*(amount[1]? -1:1);
    let description=(line.parts||[]).filter(part=>part.x>=120&&part.x<470).map(part=>readable(part.text)).join(" ").trim();
    if(!description){
      const above=source.filter(candidate=>candidate.page===line.page&&candidate.y>line.y&&candidate.y-line.y<=8);
      description=above.flatMap(candidate=>candidate.parts||[]).filter(part=>part.x>=120&&part.x<470).map(part=>readable(part.text)).join(" ").trim();
    }
    if(!description){warnings.push("Um lançamento sem descrição foi encontrado. Confira o PDF e a soma antes do envio.");continue;}
    const installmentMatch=compact(description).match(/Parc\.(\d{1,3})\/(\d{1,3})/i);
    const installment=installmentMatch?Number(installmentMatch[1])+"/"+Number(installmentMatch[2]):undefined;
    description=description.replace(/Parc\.\s*\d{1,3}\s*\/\s*\d{1,3}/i,"").trim();
    const key=compact(description).toUpperCase();
    const payment=/^PAGAMENTORECEBIDO/.test(key);
    const iof=/^IOF.*COMPRAINTERNACIONAL/.test(key);
    const international=!iof&&/-(?:USD|US\$|EUR|GBP)[\d.,]+$/i.test(compact(description));
    if(international)description=description.replace(/-\s*(?:U\s*S\s*D|USD|US\$|EUR|GBP)\s*[\d. ,]+$/i,"").trim();
    if(iof)description=description.replace(/comprainternacional/i,"compra internacional");
    if(payment)description="Pagamento recebido";
    if(/^ANUIDADE-PARCELA$/.test(key))description="Anuidade - parcela";
    if(/^ANUIDADE-BONIFICACAO$/.test(key))description="Anuidade - bonificação";
    const iso=transactionDate(Number(date[1]),MONTHS[date[2].toLowerCase()],dueDate,installment);
    if(!iso){warnings.push("Uma data inválida foi encontrada nos lançamentos da Unicred.");continue;}
    items.push({id:items.length+1,date:iso,description,amount:cents/100,installment,cardLastDigits,transactionType:payment?"INVOICE_PAYMENT":cents<0?"INVOICE_CREDIT":iof?"INTERNATIONAL_IOF":international?"INTERNATIONAL_PURCHASE":installment?"INSTALLMENT_PURCHASE":"PURCHASE",exportable:!payment});
  }
  if(!items.some(item=>item.exportable))throw new Error("Nenhum lançamento foi identificado no layout Unicred. Envie o PDF completo.");
  const sum=items.filter(item=>item.exportable).reduce((total,item)=>total+Math.round(item.amount*100),0);
  if(invoiceCents===null)warnings.push("O total da fatura Unicred não foi identificado. Confira a soma antes do envio.");
  else if(sum!==invoiceCents)warnings.push("A soma dos lançamentos foi R$ "+format(sum)+", mas a fatura informa R$ "+format(invoiceCents)+". Confira antes do envio.");
  warnings.push("As compras não informam o ano. As datas foram inferidas pelo vencimento e pela parcela atual; confira na revisão.");
  return {bank:"UNICRED",invoiceTotal:invoiceCents===null?null:invoiceCents/100,dueDate,items,warnings};
}
