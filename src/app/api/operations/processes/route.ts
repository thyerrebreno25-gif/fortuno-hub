import {NextResponse} from "next/server";
import {z} from "zod";
import {prisma} from "@/lib/prisma";
import {canManageOperations,getOperationMember} from "@/modules/operations/auth";
const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g," ").toUpperCase();
const fileTypes=z.array(z.string().max(100)).max(64).default([]);
const input=z.object({name:z.string().trim().min(3).max(120),department:z.string().trim().min(1).max(200).default("Operação"),description:z.string().trim().max(10000).nullish(),subjectToFine:z.boolean().default(false),requiresAttachment:z.boolean().default(false),allowedFileTypes:fileTypes,notifyClient:z.boolean().default(true),defaultPriority:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]).default("MEDIUM"),checklist:z.array(z.object({title:z.string().trim().min(1).max(1000),mandatory:z.boolean().default(true),requiresComment:z.boolean().default(false),requiresAttachment:z.boolean().default(false),allowDisregard:z.boolean().default(false),allowedFileTypes:fileTypes})).max(200).default([])});
export async function POST(request:Request){
 const member=await getOperationMember();if(!member)return NextResponse.json({error:"Sessão inválida."},{status:401});if(!canManageOperations(member.role)||member.canEdit===false)return NextResponse.json({error:"Sem permissão."},{status:403});
 const parsed=input.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Confira o nome da seção (3 a 120 caracteres) e as etapas informadas."},{status:400});
 const {checklist,...data}=parsed.data;
 try{const process=await prisma.operationProcess.create({data:{...data,organizationId:member.organizationId,normalizedName:normalize(data.name),description:data.description||null,checklistTemplates:{create:checklist.map((step,position)=>({...step,position}))}},include:{checklistTemplates:{orderBy:{position:"asc"}}}});return NextResponse.json({process},{status:201});}
 catch(error){return NextResponse.json({error:(error as {code?:string}).code==="P2002"?"Já existe uma seção com esse nome. Atualize a tabela.":"Não foi possível adicionar a seção. Tente novamente."},{status:(error as {code?:string}).code==="P2002"?409:500});}
}
