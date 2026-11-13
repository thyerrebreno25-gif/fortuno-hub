import type {DirectFinancialLine} from "@/components/conta-azul/direct-financial-send";
export const paymentMethods = [
  {value:"OUTRO",label:"Outro / não informado"}, {value:"BOLETO_BANCARIO",label:"Boleto bancário"},
  {value:"PIX_PAGAMENTO_INSTANTANEO",label:"Pix"}, {value:"TRANSFERENCIA_BANCARIA",label:"Transferência bancária"},
  {value:"DINHEIRO",label:"Dinheiro"}, {value:"CARTAO_CREDITO",label:"Cartão de crédito"}, {value:"CARTAO_DEBITO",label:"Cartão de débito"},
] as const;
export type PaymentMethod = typeof paymentMethods[number]["value"];
export type FinancialRepeat = {frequency:"WEEKLY"|"MONTHLY"|"YEARLY";interval:number;count:number};
export function validFinancialDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+"T12:00:00Z"))&&new Date(value+"T12:00:00Z").toISOString().slice(0,10)===value;}
export function repeatFinancialDate(value:string,index:number,repeat:FinancialRepeat){
 if(!validFinancialDate(value))return "";
 const [year,month,day]=value.split("-").map(Number);
 if(repeat.frequency==="WEEKLY")return new Date(Date.UTC(year,month-1,day+7*index*repeat.interval,12)).toISOString().slice(0,10);
 const shift=index*repeat.interval*(repeat.frequency==="YEARLY"?12:1),first=new Date(Date.UTC(year,month-1+shift,1,12));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
 first.setUTCDate(Math.min(day,last));return first.toISOString().slice(0,10);
}
export function validFinancialRepeat(value:unknown):value is FinancialRepeat {
 if(!value||typeof value!=="object")return false;
 const r=value as FinancialRepeat;return ["WEEKLY","MONTHLY","YEARLY"].includes(r.frequency)&&Number.isInteger(r.interval)&&r.interval>=1&&r.interval<=12&&Number.isInteger(r.count)&&r.count>=2&&r.count<=60;
}
export function buildWhatsAppFinancialLines(messageId:string,line:Omit<DirectFinancialLine,"lineKey">,repeat:FinancialRepeat|null):DirectFinancialLine[]{
 if(repeat&&!validFinancialRepeat(repeat))throw Error("Revise a repetição: de 2 a 60 ocorrências.");
 return Array.from({length:repeat?.count||1},(_,index)=>({...line,lineKey:index===0?messageId:`${messageId}:repeat:${index+1}`,
 competenceDate:repeat?repeatFinancialDate(line.competenceDate,index,repeat):line.competenceDate,
 dueDate:repeat?repeatFinancialDate(line.dueDate,index,repeat):line.dueDate,
 metadata:{...line.metadata,...(repeat?{repeat}:{} )}}));
}
export function validWhatsAppFinancialLines(messageId:string,lines:DirectFinancialLine[],settle:boolean){
 if(lines.length===1)return lines[0].lineKey===messageId&&validFinancialDate(lines[0].competenceDate)&&validFinancialDate(lines[0].dueDate);
 const first=lines[0],repeat=first?.metadata?.repeat;if(settle||!validFinancialRepeat(repeat)||repeat.count!==lines.length)return false;
 const expected=buildWhatsAppFinancialLines(messageId,first,repeat);
 return lines.every((line,index)=>line.lineKey===expected[index].lineKey&&line.dueDate===expected[index].dueDate&&line.competenceDate===expected[index].competenceDate&&validFinancialDate(line.dueDate)&&validFinancialDate(line.competenceDate)&&line.amount===first.amount&&line.direction===first.direction&&line.description===first.description&&line.categoryName===first.categoryName&&line.costCenterName===first.costCenterName);
}
