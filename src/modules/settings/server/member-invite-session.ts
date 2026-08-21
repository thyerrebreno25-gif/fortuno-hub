import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  buildMemberActivationUrl,
  getMemberInviteAppUrl,
  getMemberInviteRedirectTo,
} from "@/modules/settings/server/member-invite-link";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type ActivationSessionResult =
  | {
      created: true;
      activationUrl: string;
      linkType: "invite" | "recovery";
    }
  | {
      created: false;
      reason: string;
    };

export async function createFreshMemberActivationSession(
  admin: AdminClient,
  email: string,
): Promise<ActivationSessionResult> {
  const appUrl = getMemberInviteAppUrl();
  const redirectTo = getMemberInviteRedirectTo(appUrl);
  const options = redirectTo ? { redirectTo } : undefined;

  const inviteResult = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    ...(options ? { options } : {}),
  });

  let linkType: "invite" | "recovery" = "invite";
  let activationUrl = buildMemberActivationUrl(
    appUrl,
    inviteResult.data?.properties,
  );

  if (inviteResult.error || !activationUrl) {
    const recoveryResult = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      ...(options ? { options } : {}),
    });

    if (recoveryResult.error) {
      return {
        created: false,
        reason: recoveryResult.error.message,
      };
    }

    linkType = "recovery";
    activationUrl = buildMemberActivationUrl(
      appUrl,
      recoveryResult.data?.properties,
    );
  }

  if (!activationUrl) {
    return {
      created: false,
      reason: "Não foi possível iniciar a ativação do acesso.",
    };
  }

  return {
    created: true,
    activationUrl,
    linkType,
  };
}
