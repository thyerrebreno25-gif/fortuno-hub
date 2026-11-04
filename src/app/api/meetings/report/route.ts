import {after,NextResponse} from "next/server";
import {meetingAccess,meetingFailure} from "@/modules/meetings/auth";
import {requestMeetingReport,processMeetingReport} from "@/modules/meetings/reports";
import {processMeetingBackground} from "@/modules/meetings/delivery";
export const maxDuration=300;
export async function POST(request:Request){
 try{const {member}=await meetingAccess("MEETINGS","canEdit");const body=await request.json();const result=await requestMeetingReport(member,body);
 after(async()=>{await Promise.allSettled([processMeetingBackground(member.organizationId),...(result.report?[processMeetingReport(body.meetingId)]:[])]);});
 return NextResponse.json(result,{status:result.report?202:200});
 }catch(error){return meetingFailure(error);}
}
