import {after,NextResponse} from "next/server";
import {prisma} from "@/lib/prisma";
import {meetingAccess,meetingFailure,findMeeting,MeetingError} from "@/modules/meetings/auth";
import {connectFathom,publicFathomConnection,syncFathomConnection,fathomDownload} from "@/modules/meetings/fathom";
import {z} from "zod";
export const maxDuration=300;
export async function GET(){try{const {member}=await meetingAccess();const connection=await prisma.fathomConnection.findUnique({where:{organizationId_userId:{organizationId:member.organizationId,userId:member.userId}},select:publicFathomConnection});return NextResponse.json({connection});}catch(error){return meetingFailure(error);}}
export async function POST(request:Request){try{
 const {member,permissions}=await meetingAccess();const body=await request.json();
 if(body.action==="download"){
  const {id}=z.object({id:z.string().min(1).max(100)}).parse(body);
  const recording=await prisma.fathomRecording.findUnique({where:{id},select:{meetingId:true}});if(!recording)throw new MeetingError("Gravação não encontrada.",404);
  const meeting=await findMeeting(member,recording.meetingId);if(!meeting.fathomEnabled)throw new MeetingError("A gravação está desativada nesta reunião.",409);
  return NextResponse.json(await fathomDownload(id),{headers:{"Cache-Control":"no-store"}});
 }
 if(!permissions.canEdit)throw new MeetingError("Seu perfil não permite alterar a integração.",403);
 if(body.action==="connect")await connectFathom(member,body);
 else if(body.action!=="sync")throw new MeetingError("Ação inválida.");
 const connection=await prisma.fathomConnection.findUnique({where:{organizationId_userId:{organizationId:member.organizationId,userId:member.userId}},select:publicFathomConnection});
 if(!connection?.enabled)throw new MeetingError("Conecte sua conta Fathom primeiro.",409);
 after(()=>syncFathomConnection(connection.id));
 return NextResponse.json({connection,queued:true},{status:202});
 }catch(error){return meetingFailure(error);}}
export async function DELETE(){try{const {member}=await meetingAccess("MEETINGS","canEdit");await prisma.fathomConnection.updateMany({where:{organizationId:member.organizationId,userId:member.userId},data:{enabled:false,syncClaimedAt:null}});return NextResponse.json({ok:true});}catch(error){return meetingFailure(error);}}
