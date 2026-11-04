import {brDate,monthDate,moneyCents,normalize,type InvestmentReview} from "./model";
import type {DocumentLine} from "./parsers";
const values=(text:string)=>[...text.matchAll(/-?\s*(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)/g)].map(match=>moneyCents(match[0].replace(/\s/g,"")));
const shortDate=(text:string)=>brDate(text.replace(/(\d{2}\/\d{2}\/)(\d{2})$/, (_,prefix,year)=>prefix+"20"+year));
function empty(source:InvestmentReview["source"]):InvestmentReview{return {kind:"INVESTMENT",source,periodStart:"",periodEnd:"",bankAccount:"",rows:[],warnings:[]};}
export function parseNubank(lines:DocumentLine[]):InvestmentReview{
 const result=empty("NUBANK");result.bankAccount="NUBANK-CAIXINHAS";
 for(const page of [...new Set(lines.map(row=>row.page))]){
  const rows=lines.filter(row=>row.page===page);const product=rows.find(row=>/^rdb\b/.test(normalize(row.text)))?.text.trim();
  const completed=rows.findIndex(row=>normalize(row.text).includes("transacoes concluidas")),processing=rows.findIndex(row=>normalize(row.text)==="transacoes em processamento");
  if(completed<0)continue;const settled=rows.slice(completed,processing<0?rows.length:processing);
  const income=settled.findIndex(row=>normalize(row.text).includes("rendimento ate"));if(!product||income<0)continue;
  const evidence=settled.slice(Math.max(0,income-1),income+3).map(row=>row.text).join(" ");
  const match=evidence.match(/(\d{2}\/\d{2}\/\d{4})[\s\S]*?R\$\s*([\d.]+,\d{2})/);
  const balance=rows.map(row=>row.text).join(" ").match(/saldo no final do per[ií]odo:\s*R\$\s*([\d.]+,\d{2})/i);
  if(!match||!balance){result.warnings.push("Página "+page+": rendimento ou saldo final não reconhecido.");continue;}
  const date=brDate(match[1]),amountCents=moneyCents(match[2]);if(!date)continue;
  const key="nubank|"+normalize(product)+"|"+date;
  if(result.rows.some(row=>row.key===key)){result.warnings.push("Tipo de caixinha repetido: confira o documento antes de consolidar.");continue;}
  result.rows.push({key,description:product,date,amountCents,closingCents:moneyCents(balance[1]),method:"EXPLICIT",categoryId:"",accountId:"",evidence:[{page,text:evidence.slice(0,500),amountCents}]});
 }
 const dates=result.rows.map(row=>row.date).sort();if(dates.length){result.periodStart=dates[0].slice(0,7)+"-01";result.periodEnd=dates.at(-1)!;}
 result.warnings.push("Período apurado pela data dos rendimentos, não pela emissão do PDF. O documento não informa número da conta; selecione as contas de caixinhas corretas no CA.");return result;
}
export function parseMultinvest(lines:DocumentLine[]):InvestmentReview{
 const result=empty("MULTINVEST"),all=lines.map(row=>row.text.replace(/\u0000/g,"a")).join(" ");
 const period=all.match(/per[ií]odo de\s+(\d{2}\/\d{2}\/\d{2,4})\s+.*?\s+(\d{2}\/\d{2}\/\d{2,4})/i);
 if(period){result.periodStart=shortDate(period[1]);result.periodEnd=shortDate(period[2]);}
 result.bankAccount=all.match(/cont\s*a\s+investimento\s+(\d+)/i)?.[1]||"";
 const summaryPage=lines.find(row=>normalize(row.text).includes("sumario - distribuicao"))?.page;
 const summary=lines.filter(row=>row.page===summaryPage);
 let balances:number[]=[];let summaryEvidence:DocumentLine|undefined;
 for(let i=0;i<summary.length;i++)if(normalize(summary[i].text)==="total"||/^total\s+\d/.test(normalize(summary[i].text))){
  for(const index of [i,i-1,i+1]){if(!summary[index])continue;const numbers=values(summary[index].text);if(numbers.length===4){balances=numbers;summaryEvidence=summary[index];break;}}if(balances.length)break;
 }
 if(!balances.length){result.warnings.push("Sumário com os quatro saldos bruto/líquido não reconhecido. Nenhum rendimento foi calculado.");return result;}
 const evidence:InvestmentReview["rows"][number]["evidence"]=[{page:summaryEvidence!.page,text:"Saldo bruto anterior e atual: "+summaryEvidence!.text.slice(0,400),amountCents:balances[2]}];
 const movementStart=lines.findIndex(row=>/cont.*corrente - movimentacao/.test(normalize(row.text)));
 const movements:Array<{date:string;text:string;page:number}>=[];
 if(movementStart<0){result.warnings.push("Extrato de movimentação não localizado; não foi possível conferir os resgates.");return result;}
 for(const line of lines.slice(movementStart+1)){
  const text=line.text.replace(/\u0000/g,"a"),date=text.match(/^(\d{2}\/\d{2}\/\d{2,4})\b/);
  if(date)movements.push({date:shortDate(date[1]),text,page:line.page});
  else if(movements.length){if(/^(total de|perfil|disclaimers)/.test(normalize(text)))break;movements.at(-1)!.text+=" "+text;}
 }
 let transferred=0;
 for(let i=0;i<movements.length;i++){
  const row=movements[i];if(!normalize(row.text).includes("resgate de cotas no fundo"))continue;
  const amount=values(row.text)[0],next=movements[i+1],out=next?values(next.text)[0]:undefined;
  if(amount===undefined) {result.warnings.push("Resgate sem valor reconhecido: confira a movimentação.");return {...result,rows:[]};}
  const included=row.date>=result.periodStart&&row.date<=result.periodEnd&&!!next&&normalize(next.text).includes("envio transferencia")&&next.date===row.date&&out===-amount&&amount>0;
  if(included)transferred+=amount;
  evidence.push({page:row.page,text:(included?"Resgate com transferência imediata: ":"Resgate ignorado (sem transferência imediatamente abaixo): ")+row.text.slice(0,370),amountCents:Math.abs(amount)});
  if(included)evidence.push({page:next.page,text:next.text.slice(0,500),amountCents:Math.abs(out!)});
 }
 const amountCents=balances[2]-balances[0]+transferred;
 result.rows=[{key:"multinvest|fundos|"+result.periodEnd,description:"Multinvest Capital - Fundos de investimento",date:result.periodEnd,amountCents:Math.max(0,amountCents),closingCents:balances[2],openingCents:balances[0],transferredRedemptionsCents:transferred,method:"STATEMENT_DELTA",categoryId:"",accountId:"",evidence}];
 if(amountCents<=0)result.warnings.push("A variação ajustada não é uma receita positiva. O envio de rendimento ficará bloqueado.");return result;
}
export function parseXp(lines:DocumentLine[]):InvestmentReview{
 const result=empty("XP"),all=lines.map(row=>row.text).join(" ");
 result.bankAccount=all.match(/conta:\s*(\d+)/i)?.[1]||"";
 const reference=all.match(/data de refer[eê]ncia:\s*(\d{2}\/\d{2}\/\d{4})/i);if(reference){result.periodEnd=brDate(reference[1]);result.periodStart=result.periodEnd.slice(0,7)+"-01";}
 for(let i=0;i<lines.length;i++){
  const text=normalize(lines[i].text);const group=/^\d+(?:[.,]\d+)?% renda fixa$/.test(text)?"Renda fixa":/^\d+(?:[.,]\d+)?% fundos de investimento$/.test(text)?"Fundos de investimento":"";
  if(!group)continue;
  const next=lines.slice(i+1,i+3).find(row=>row.page===lines[i].page&&/^R\$\s*[\d.]+,\d{2}$/.test(row.text.trim()));
  if(!next)continue;const closing=values(next.text)[0];if(closing===undefined)continue;
  const key="xp|"+normalize(group)+"|"+result.periodEnd;
  if(result.rows.some(row=>row.key===key)){result.warnings.push("Posição repetida para "+group+". Confira se há duplicação de páginas.");continue;}
  result.rows.push({key,description:"XP - "+group,date:result.periodEnd,amountCents:0,closingCents:closing,method:"CA_DELTA",categoryId:"",accountId:"",evidence:[{page:lines[i].page,text:group+" - Posição: "+next.text,amountCents:closing}]});
 }
 result.warnings.push("Selecione uma conta distinta para renda fixa e fundos. O rendimento será a posição do PDF menos o saldo do CA no fechamento anterior ("+monthDate(result.periodStart,-1,"last")+"). Aportes e resgates no mês podem afetar essa diferença e devem ser conferidos.");return result;
}
