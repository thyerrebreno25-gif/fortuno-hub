type MemberRole = "ADMIN" | "MANAGER" | "OPERATOR" | "CLIENT";

type MemberInviteEmailInput = {
  to: string;
  name: string;
  role: MemberRole;
  actionUrl: string;
};

export type MemberInviteEmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: string };

const roleLabels: Record<MemberRole, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gestor",
  OPERATOR: "Operador",
  CLIENT: "Cliente",
};

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtml(input: MemberInviteEmailInput): string {
  const logoUrl = process.env.FORTUNO_LOGO_URL?.trim();

  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Fortuno Gestão Financeira" width="210" style="display:block;width:210px;max-width:100%;height:auto;border:0;margin:0 auto;">`
    : `
      <div style="font-size:32px;line-height:36px;letter-spacing:5px;color:#163b75;font-weight:300;">FORTUNO</div>
      <div style="margin-top:4px;font-size:9px;letter-spacing:3px;color:#94a3b8;font-weight:700;">GESTÃO FINANCEIRA</div>
    `;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Seu acesso ao Fortuno Hub</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Seu acesso ao Fortuno Hub foi criado.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:34px 32px 26px;background:#ffffff;">
                ${logo}
              </td>
            </tr>

            <tr>
              <td style="padding:0 32px;">
                <div style="height:1px;background:#edf1f6;"></div>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:30px 32px 10px;">
                <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:800;letter-spacing:.8px;">
                  ACESSO LIBERADO
                </div>
                <h1 style="margin:14px 0 8px;font-size:27px;line-height:35px;color:#102a56;">
                  Bem-vindo(a) ao Fortuno Hub
                </h1>
                <p style="margin:0;font-size:14px;line-height:22px;color:#64748b;">
                  Seu usuário foi criado e já está vinculado ao ambiente corporativo.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 32px 30px;">
                <p style="margin:0 0 18px;font-size:15px;line-height:24px;color:#334155;">
                  Olá, <strong>${esc(input.name)}</strong>.
                </p>

                <p style="margin:0 0 22px;font-size:15px;line-height:24px;color:#334155;">
                  Você recebeu acesso ao <strong>Fortuno Hub</strong>. Para concluir seu cadastro e acessar o sistema, utilize o botão abaixo.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-collapse:separate;">
                  <tr>
                    <td style="padding:18px;border:1px solid #e3e9f2;border-radius:14px;background:#f8fafc;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td width="50%" valign="top" style="padding:0 12px 0 0;">
                            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">E-mail</div>
                            <div style="margin-top:5px;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${esc(input.to)}</div>
                          </td>
                          <td width="50%" valign="top" style="padding:0 0 0 12px;">
                            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">Perfil</div>
                            <div style="margin-top:5px;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${esc(roleLabels[input.role])}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;">
                  <tr>
                    <td align="center">
                      <a href="${esc(input.actionUrl)}" style="display:inline-block;background:#163b75;color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:15px 28px;border-radius:10px;">
                        Ativar meu acesso
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="margin:14px 0 0;text-align:center;font-size:12px;line-height:19px;color:#94a3b8;">
                  Este link é pessoal e temporário. Não encaminhe este e-mail para outras pessoas.
                </p>

                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;">
                  <tr>
                    <td style="padding:15px 17px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;font-size:13px;line-height:20px;color:#9a3412;">
                      Se você não esperava receber este acesso, ignore esta mensagem e informe o administrador da sua organização.
                    </td>
                  </tr>
                </table>

                <p style="margin:26px 0 0;font-size:14px;line-height:22px;color:#475569;">
                  Bem-vindo(a) à operação.
                </p>

                <p style="margin:18px 0 0;font-size:14px;line-height:22px;color:#334155;">
                  <strong style="color:#102a56;">Fortuno Gestão Financeira</strong><br>
                  <span style="color:#64748b;">Fortuno Hub</span>
                </p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:20px 24px;background:#f8fafc;border-top:1px solid #edf1f6;">
                <p style="margin:0;font-size:11px;line-height:18px;color:#94a3b8;">
                  Este e-mail foi enviado automaticamente pelo Fortuno Hub.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(input: MemberInviteEmailInput): string {
  return `
FORTUNO GESTÃO FINANCEIRA
FORTUNO HUB

Olá, ${input.name}.

Seu acesso ao Fortuno Hub foi criado.

E-mail: ${input.to}
Perfil: ${roleLabels[input.role]}

Para concluir seu cadastro e acessar o sistema:
${input.actionUrl}

Este link é pessoal e temporário. Não compartilhe com outras pessoas.

Fortuno Gestão Financeira
Fortuno Hub
  `.trim();
}

export async function sendMemberInviteEmail(
  input: MemberInviteEmailInput,
): Promise<MemberInviteEmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();

  if (!key) {
    return {
      sent: false,
      reason: "RESEND_API_KEY não configurada.",
    };
  }

  if (!input.actionUrl) {
    return {
      sent: false,
      reason: "Link de ativação não foi gerado.",
    };
  }

  const from =
    process.env.MEMBERS_FROM_EMAIL?.trim() ||
    process.env.SUPPORT_FROM_EMAIL?.trim() ||
    process.env.OPERATIONS_FROM_EMAIL?.trim() ||
    "Fortuno Hub <notificacoes@hubsuporte.shop>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: "Seu acesso ao Fortuno Hub está pronto",
        html: buildHtml(input),
        text: buildText(input),
        tags: [
          { name: "module", value: "settings" },
          { name: "event", value: "member_invited" },
          { name: "role", value: input.role.toLowerCase() },
        ],
      }),
    });

    const payload = (await response.json()) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok) {
      return {
        sent: false,
        reason:
          payload.message ||
          payload.name ||
          `Resend respondeu com status ${response.status}.`,
      };
    }

    return {
      sent: true,
      id: payload.id,
    };
  } catch (error) {
    return {
      sent: false,
      reason:
        error instanceof Error
          ? error.message
          : "Falha desconhecida ao enviar e-mail.",
    };
  }
}