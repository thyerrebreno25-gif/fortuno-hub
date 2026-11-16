import type {AuditFindingDraft} from "./types";
export type AuditAccountBalance={id:string;name:string;type:string;date:string;balanceCents:number|null;method:string;reason?:string};
const fold=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").trim();
export function isTransitoryAccount(name:string,type:string){
 const kind=fold(type),text=fold(name);
 if(/CORRENTE|INVEST|APLICACAO|POUPAN|CAIXA|CAIXINHA|DINHEIRO/.test(kind)||/\bPOUPANCA\b|\bINVESTIMENTO\b|\bAPLICACAO\b/.test(text))return false;
 return /ADQUIREN|TRANSITOR|MEIOS?( DE)? RECEBIMENTO|CONTA DE RECEBIMENTO|RECEBA FACIL CARTAO|COBRANCAS CONTA AZUL/.test(kind+" "+text)||/\bCIELO\b|\bGETNET\b|\bIFOOD\b|\bSTONE\b|\bREDE\b|\bPAGSEGURO\b|\bSUMUP\b|\bSAFRAPAY\b|\bTON\b|\bPAGBANK\b|\bMERCADO PAGO\b/.test(text);
}
export function transitoryBalanceFindings(accounts:AuditAccountBalance[]):AuditFindingDraft[]{
 return accounts.flatMap(account=>{
  if(account.balanceCents===0)return [];
  const unavailable=account.balanceCents===null;
  return [{localId:"CA_TRANSITORY_"+account.id,ruleCode:unavailable?"CA_TRANSITORY_BALANCE_UNAVAILABLE":"CA_TRANSITORY_NONZERO",flow:"GENERAL" as const,severity:"WARNING" as const,title:unavailable?`Fechamento indisponível: ${account.name}`:`Saldo não zerado: ${account.name}`,description:unavailable?"O saldo no encerramento não pôde ser confirmado. Confira o extrato da conta transitória e registre a validação.":`A conta transitória encerrou ${account.date} com saldo diferente de zero. Confira repasses, tarifas e lançamentos pendentes.`,subject:account.name,amount:unavailable?null:account.balanceCents!/100,evidence:[{label:"Conta financeira",value:account.name},{label:"Data do fechamento",value:account.date},{label:"Saldo no fechamento",value:unavailable?"Indisponível":new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(account.balanceCents!/100)},{label:"Método",value:account.method},...(account.reason?[{label:"Motivo",value:account.reason}]:[])]}];
 });
}
