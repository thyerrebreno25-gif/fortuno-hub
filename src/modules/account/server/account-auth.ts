import { prisma } from "@/lib/prisma";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export async function getAccountMember() {
  const supabase = await createSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const member = await prisma.organizationMember.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      organizationId: true,
      userId: true,
      role: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
        },
      },
      user: {
        select: {
          avatar:true,
          id: true,
          name: true,
          email: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
  return member ? {...member, notificationsMuted:user.user_metadata?.fortuno_notifications_muted===true} : null;
}
