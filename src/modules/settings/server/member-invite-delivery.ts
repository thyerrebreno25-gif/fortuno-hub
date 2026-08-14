import "server-only";

import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMemberInviteEmail } from "@/modules/settings/email/member-invite-email";
import {
  buildMemberActivationUrl,
  getMemberInviteAppUrl,
  getMemberInviteRedirectTo,
} from "@/modules/settings/server/member-invite-link";

export type MemberInviteRole =
  | "ADMIN"
  | "MANAGER"
  | "OPERATOR"
  | "CLIENT";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type DeliveryResult =
  | {
      sent: true;
      linkType: "invite" | "recovery";
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
  admin: AdminClient,
  input: {
    email: string;
    name: string;
    role: MemberInviteRole;
    reminder?: boolean;
  },
): Promise<DeliveryResult> {
  const appUrl = getMemberInviteAppUrl();
  const redirectTo = getMemberInviteRedirectTo(appUrl);

  const inviteResult = await admin.auth.admin.generateLink({
    type: "invite",
    email: input.email,
    options: {
      data: { name: input.name },
      ...(redirectTo ? { redirectTo } : {}),
    },
  });

  let linkType: "invite" | "recovery" = "invite";
  let actionUrl = buildMemberActivationUrl(
    appUrl,
    inviteResult.data?.properties,
  );

  if (inviteResult.error || !actionUrl) {
    const recoveryResult = await admin.auth.admin.generateLink({
      type: "recovery",
      email: input.email,
      options: {
        ...(redirectTo ? { redirectTo } : {}),
      },
    });

    if (recoveryResult.error) {
      return {
        sent: false,
        reason: recoveryResult.error.message,
      };
    }

    linkType = "recovery";
    actionUrl = buildMemberActivationUrl(
      appUrl,
      recoveryResult.data?.properties,
    );
  }

  if (!actionUrl) {
    return {
      sent: false,
      reason: "Não foi possível gerar um novo link de ativação.",
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
    linkType,
    emailId: emailResult.id,
  };
}
