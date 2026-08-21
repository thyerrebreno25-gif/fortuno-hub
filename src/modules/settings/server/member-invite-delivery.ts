import "server-only";

import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { sendMemberInviteEmail } from "@/modules/settings/email/member-invite-email";
import { createPermanentMemberInviteUrl } from "@/modules/settings/server/member-invite-token";

export type MemberInviteRole =
  | "ADMIN"
  | "MANAGER"
  | "OPERATOR"
  | "CLIENT";

type DeliveryResult =
  | {
      sent: true;
      linkType: "permanent";
      emailId?: string;
    }
  | {
      sent: false;
      reason: string;
    };

export function isMemberAccessActivated(authUser: SupabaseAuthUser) {
  return Boolean(
    authUser.email_confirmed_at ||
      authUser.confirmed_at ||
      authUser.last_sign_in_at ||
      authUser.factors?.some(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "verified",
      ),
  );
}

export async function deliverMemberInvite(
  input: {
    memberId: string;
    email: string;
    name: string;
    role: MemberInviteRole;
    reminder?: boolean;
  },
): Promise<DeliveryResult> {
  let actionUrl: string;

  try {
    actionUrl = await createPermanentMemberInviteUrl(input.memberId);
  } catch (error) {
    return {
      sent: false,
      reason:
        error instanceof Error
          ? error.message
          : "Não foi possível gerar o link permanente de ativação.",
    };
  }

  const emailResult = await sendMemberInviteEmail({
    to: input.email,
    name: input.name,
    role: input.role,
    actionUrl,
    reminder: input.reminder,
  });

  if (!emailResult.sent) {
    return emailResult;
  }

  return {
    sent: true,
    linkType: "permanent",
    emailId: emailResult.id,
  };
}
