import {NextResponse} from "next/server";
import {beginReportChatConnection,listReportSpaces,reportConfigurationMember} from "@/modules/management/operator-report-google";
import {OperatorChatError,operatorChatErrorBody} from "@/modules/management/operator-chat-error";
const headers={"Cache-Control":"private, no-store"};
export async function POST(request:Request){try{return NextResponse.json(await beginReportChatConnection(request),{headers});}catch(error){return NextResponse.json(operatorChatErrorBody(error),{status:error instanceof OperatorChatError?error.status:503,headers});}}
export async function GET(){try{const member=await reportConfigurationMember();return NextResponse.json({spaces:await listReportSpaces(member.organizationId,member.userId)},{headers});}catch(error){return NextResponse.json(operatorChatErrorBody(error),{status:error instanceof OperatorChatError?error.status:503,headers});}}
