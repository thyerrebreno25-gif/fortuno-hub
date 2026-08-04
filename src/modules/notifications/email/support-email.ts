type SupportPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type NewSupportTicketEmailInput = {
  ticketId: string;
  ticketCode: string;
  subject: string;
  description: string;
  priority: SupportPriority;
  category: string;
  module: string;
  requesterName: string;
  requesterEmail: string;
  createdAt: Date;
};

type EmailResult =
  | { sent: true; messageId?: string }
  | { sent: false; reason: string };

const priorityLabels: Record<SupportPriority, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const priorityStyles: Record<SupportPriority, { background: string; color: string; border: string }> = {
  LOW: { background: "#f1f3f5", color: "#495057", border: "#dee2e6" },
  MEDIUM: { background: "#e7f5ff", color: "#1971c2", border: "#a5d8ff" },
  HIGH: { background: "#fff4e6", color: "#d9480f", border: "#ffd8a8" },
  CRITICAL: { background: "#fff0f0", color: "#c92a2a", border: "#ffc9c9" },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseRecipients(): string[] {
  const raw = process.env.SUPPORT_NOTIFICATION_EMAILS || process.env.SUPPORT_NOTIFICATION_EMAIL || "";
  return Array.from(new Set(raw.split(",").map((email) => email.trim()).filter(Boolean)));
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function buildTicketUrl(ticketId: string): string {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").replace(/\/+$/, "");
  return appUrl ? `${appUrl}/suporte?ticket=${encodeURIComponent(ticketId)}` : "";
}

function buildSupportTicketHtml(input: NewSupportTicketEmailInput): string {
  const priority = priorityStyles[input.priority];
  const ticketUrl = buildTicketUrl(input.ticketId);
  const safeDescription = escapeHtml(input.description).replaceAll("\n", "<br />");

  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#10213d;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f6fb;">
      <tr><td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #dfe6ef;border-radius:18px;overflow:hidden;box-shadow:0 10px 32px rgba(16,33,61,.08);">
          <tr><td style="padding:0;background:#0b2d5c;">
            <div style="height:7px;background:linear-gradient(90deg,#1c7ed6,#4dabf7,#f4a340);"></div>
            <div style="padding:28px 32px;">
              <table role="presentation" width="100%"><tr>
                <td>
                  <div style="font-size:13px;font-weight:800;letter-spacing:1.4px;color:#8ec5ff;text-transform:uppercase;">Fortuno Hub</div>
                  <div style="margin-top:7px;font-size:28px;font-weight:800;color:#ffffff;">Novo chamado aberto</div>
                  <div style="margin-top:8px;font-size:14px;color:#cfe5ff;">Automação e gestão operacional</div>
                </td>
                <td align="right" valign="top">
                  <div style="display:inline-block;padding:9px 13px;border-radius:999px;background:#ffffff;color:#0b2d5c;font-size:13px;font-weight:800;">${escapeHtml(input.ticketCode)}</div>
                </td>
              </tr></table>
            </div>
          </td></tr>

          <tr><td style="padding:30px 32px 12px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:.8px;color:#74839a;text-transform:uppercase;">Assunto</div>
            <div style="margin-top:7px;font-size:22px;line-height:1.35;font-weight:800;color:#10213d;">${escapeHtml(input.subject)}</div>
          </td></tr>

          <tr><td style="padding:16px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="50%" valign="top" style="padding:0 8px 12px 0;"><div style="border:1px solid #e4e9f0;border-radius:12px;padding:14px 16px;"><div style="font-size:11px;font-weight:800;color:#8491a3;text-transform:uppercase;">Solicitante</div><div style="margin-top:5px;font-size:14px;font-weight:700;">${escapeHtml(input.requesterName)}</div><div style="margin-top:3px;font-size:12px;color:#69778c;">${escapeHtml(input.requesterEmail)}</div></div></td>
                <td width="50%" valign="top" style="padding:0 0 12px 8px;"><div style="border:1px solid #e4e9f0;border-radius:12px;padding:14px 16px;"><div style="font-size:11px;font-weight:800;color:#8491a3;text-transform:uppercase;">Prioridade</div><div style="margin-top:6px;"><span style="display:inline-block;padding:5px 10px;border-radius:999px;background:${priority.background};color:${priority.color};border:1px solid ${priority.border};font-size:12px;font-weight:800;">${priorityLabels[input.priority]}</span></div></div></td>
              </tr>
              <tr>
                <td width="50%" valign="top" style="padding:0 8px 0 0;"><div style="border:1px solid #e4e9f0;border-radius:12px;padding:14px 16px;"><div style="font-size:11px;font-weight:800;color:#8491a3;text-transform:uppercase;">Módulo</div><div style="margin-top:5px;font-size:14px;font-weight:700;">${escapeHtml(input.module)}</div></div></td>
                <td width="50%" valign="top" style="padding:0 0 0 8px;"><div style="border:1px solid #e4e9f0;border-radius:12px;padding:14px 16px;"><div style="font-size:11px;font-weight:800;color:#8491a3;text-transform:uppercase;">Categoria</div><div style="margin-top:5px;font-size:14px;font-weight:700;">${escapeHtml(input.category)}</div></div></td>
              </tr>
            </table>
          </td></tr>

          <tr><td style="padding:12px 32px 8px;">
            <div style="font-size:12px;font-weight:800;letter-spacing:.8px;color:#74839a;text-transform:uppercase;">Descrição</div>
            <div style="margin-top:9px;padding:18px;border-radius:13px;background:#f7f9fc;border:1px solid #e4e9f0;font-size:14px;line-height:1.65;color:#263a57;">${safeDescription}</div>
          </td></tr>

          <tr><td style="padding:22px 32px 30px;">
            ${ticketUrl ? `<a href="${escapeHtml(ticketUrl)}" style="display:block;text-align:center;text-decoration:none;background:#1971c2;color:#ffffff;border-radius:11px;padding:14px 20px;font-size:15px;font-weight:800;">Abrir chamado no Fortuno Hub</a>` : `<div style="text-align:center;padding:12px 18px;border-radius:11px;background:#edf2f7;color:#526178;font-size:13px;">Acesse o Fortuno Hub para visualizar o chamado.</div>`}
            <div style="margin-top:16px;text-align:center;font-size:12px;color:#8995a6;">Chamado criado em ${escapeHtml(formatDate(input.createdAt))}</div>
          </td></tr>

          <tr><td style="padding:20px 32px;background:#f7f9fc;border-top:1px solid #e4e9f0;text-align:center;">
            <div style="font-size:12px;color:#77859a;">Esta é uma notificação automática do Fortuno Hub.</div>
            <div style="margin-top:5px;font-size:11px;color:#9aa4b3;">Não compartilhe informações sensíveis fora do ambiente corporativo.</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function buildSupportTicketText(input: NewSupportTicketEmailInput): string {
  const url = buildTicketUrl(input.ticketId);
  return [
    "FORTUNO HUB",
    "Novo chamado aberto",
    "",
    `Código: ${input.ticketCode}`,
    `Assunto: ${input.subject}`,
    `Solicitante: ${input.requesterName} <${input.requesterEmail}>`,
    `Módulo: ${input.module}`,
    `Categoria: ${input.category}`,
    `Prioridade: ${priorityLabels[input.priority]}`,
    `Criado em: ${formatDate(input.createdAt)}`,
    "",
    "Descrição:",
    input.description,
    "",
    url ? `Abrir chamado: ${url}` : "Acesse o Fortuno Hub para abrir o chamado.",
  ].join("\n");
}

export async function sendNewSupportTicketEmail(input: NewSupportTicketEmailInput): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const recipients = parseRecipients();
  const from = process.env.SUPPORT_FROM_EMAIL?.trim() || "Fortuno Hub <onboarding@resend.dev>";

  if (!apiKey) return { sent: false, reason: "RESEND_API_KEY não configurada." };
  if (recipients.length === 0) return { sent: false, reason: "SUPPORT_NOTIFICATION_EMAIL ou SUPPORT_NOTIFICATION_EMAILS não configurado." };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `support-ticket-${input.ticketId}`,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        reply_to: input.requesterEmail,
        subject: `${input.priority === "CRITICAL" ? "🚨" : input.priority === "HIGH" ? "⚠️" : "🎫"} Novo chamado ${input.ticketCode} — ${input.subject}`,
        html: buildSupportTicketHtml(input),
        text: buildSupportTicketText(input),
        tags: [
          { name: "module", value: "support" },
          { name: "event", value: "ticket_created" },
          { name: "priority", value: input.priority.toLowerCase() },
        ],
      }),
    });

    const payload = (await response.json()) as { id?: string; message?: string; name?: string };
    if (!response.ok) return { sent: false, reason: payload.message || payload.name || `Resend respondeu com status ${response.status}.` };
    return { sent: true, messageId: payload.id };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : "Falha desconhecida ao enviar e-mail." };
  }
}
