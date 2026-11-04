import {monthDate,type InvestmentReview} from "./model";
import type {AccountClosingBalance} from "./balance-model";
export function applyInvestmentBaselines(review:InvestmentReview,balances:AccountClosingBalance[]):InvestmentReview{
 const baselineDate=monthDate(review.periodStart,-1,"last"),rows=review.rows.filter(row=>row.method==="CA_DELTA");
 if(rows.some(row=>!row.accountId)||new Set(rows.map(row=>row.accountId)).size!==rows.length)throw new Error("Selecione contas distintas para renda fixa e fundos da XP.");
 const warnings=review.warnings.filter(text=>!text.startsWith("XP: "));
 return {...review,warnings,rows:review.rows.map(row=>{
  if(row.method!=="CA_DELTA")return row;
  const balance=balances.find(item=>item.accountId===row.accountId&&item.date===baselineDate);
  if(!balance||balance.balanceCents===null||balance.method==="UNAVAILABLE"||row.closingCents===undefined)throw new Error(row.description+": saldo do fechamento anterior indisponível. "+(balance?.reason||"Confira a conta e o período."));
  const delta=row.closingCents-balance.balanceCents;
  if(delta<=0)warnings.push("XP: "+row.description+" não apresenta rendimento positivo pela diferença de saldos. Confira aportes, resgates e eventuais perdas; nenhum envio automático será liberado.");
  return {...row,amountCents:Math.max(0,delta),baseline:{accountId:row.accountId,date:baselineDate,balanceCents:balance.balanceCents,checkedAt:balance.checkedAt}};
 })};
}
export function baselineDifferenceIssues(review:InvestmentReview,balances:AccountClosingBalance[]){
 try{const recalculated=applyInvestmentBaselines(review,balances);return review.rows.flatMap((row,index)=>row.method==="CA_DELTA"&&(row.amountCents!==recalculated.rows[index].amountCents||row.baseline?.balanceCents!==recalculated.rows[index].baseline?.balanceCents||row.baseline?.date!==recalculated.rows[index].baseline?.date||row.baseline?.accountId!==row.accountId)?[row.description+": o saldo anterior do CA mudou ou não foi consultado. Calcule novamente e salve a revisão."]:[]);}catch(error){return [error instanceof Error?error.message:"Não foi possível conferir o saldo anterior do CA."];}
}
