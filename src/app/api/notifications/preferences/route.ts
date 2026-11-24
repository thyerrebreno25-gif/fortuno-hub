import {NextResponse} from "next/server";
import {z} from "zod";
import {createClient} from "@/lib/supabase/server";

const headers={"Cache-Control":"private, no-store"};
export async function GET(){
  const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Sessão inválida."},{status:401,headers});
  return NextResponse.json({userId:user.id,notificationsMuted:user.user_metadata?.fortuno_notifications_muted===true},{headers});
}
export async function PATCH(request:Request){
  const supabase=await createClient(),{data:{user},error}=await supabase.auth.getUser();
  if(error||!user)return NextResponse.json({error:"Sessão inválida."},{status:401,headers});
  const body=z.object({notificationsMuted:z.boolean()}).strict().safeParse(await request.json().catch(()=>null));
  if(!body.success)return NextResponse.json({error:"Preferência inválida."},{status:400,headers});
  // Auth metadata is personal, persisted across sessions, and is never used
  // for authorization. Only the signed-in user can update this preference.
  const saved=await supabase.auth.updateUser({data:{fortuno_notifications_muted:body.data.notificationsMuted}});
  if(saved.error||!saved.data.user)return NextResponse.json({error:"Não foi possível salvar a preferência. Tente novamente."},{status:502,headers});
  return NextResponse.json({userId:user.id,notificationsMuted:saved.data.user.user_metadata?.fortuno_notifications_muted===true},{headers});
}
