import "server-only";
import {closingAccountBalance} from "./account-balance";
import {monthDate,type InvestmentReview} from "./model";
export async function investmentBaselineBalances(clientId:string,review:InvestmentReview,deadline=Date.now()+220000){
 const rows=review.rows.filter(row=>row.method==="CA_DELTA"),date=monthDate(review.periodStart,-1,"last");
 if(!date||rows.some(row=>!row.accountId)||new Set(rows.map(row=>row.accountId)).size!==rows.length)throw new Error("Selecione o período e contas distintas para cada posição da XP.");
 const balances=[];for(const row of rows)balances.push(await closingAccountBalance(clientId,row.accountId,date,new Date(),deadline));return balances;
}
