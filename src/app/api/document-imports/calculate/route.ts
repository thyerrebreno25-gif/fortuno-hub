import {NextResponse} from "next/server";
import {z} from "zod";
import {authorizedCompany,importAccess,importOptions} from "@/modules/document-imports/server";
import {investmentSchema} from "@/modules/document-imports/model";
import {applyInvestmentBaselines} from "@/modules/document-imports/investment-calculation";
import {investmentBaselineBalances} from "@/modules/document-imports/investment-calculation-server";
export const maxDuration=300;
export async function POST(request:Request){
 const access=await importAccess("INVESTMENT");if(!access)return NextResponse.json({error:"Sessão inválida."},{status:401});
 if(!access.permission.canEdit)return NextResponse.json({error:"Sem permissão para revisar rendimentos."},{status:403});
 const body=z.object({clientId:z.string().min(1).max(100),review:investmentSchema}).safeParse(await request.json().catch(()=>null));if(!body.success)return NextResponse.json({error:"Revisão inválida."},{status:400});
 if(!await authorizedCompany(access.member.organizationId,body.data.clientId))return NextResponse.json({error:"Empresa não encontrada."},{status:404});
 try{const {clientId,review}=body.data;const options=await importOptions(clientId,"INVESTMENT");
 if(review.rows.some(row=>row.method==="CA_DELTA"&&!options.financialAccounts.some(account=>account.value===row.accountId)))return NextResponse.json({error:"Selecione contas da empresa escolhida."},{status:400});
 const balances=await investmentBaselineBalances(clientId,review);return NextResponse.json({review:applyInvestmentBaselines(review,balances),balances});
 }catch(error){return NextResponse.json({error:error instanceof Error&&!/token|bearer|https?:|prisma/i.test(error.message)?error.message:"Não foi possível calcular com o fechamento anterior do CA."},{status:422});}
}
