type CompletionInput = {
  to: string[];
  activityId: string;
  title: string;
  clientName: string;
  responsibleName: string;
  completedAt: Date;
  totalSeconds: number;
  checklistDone: number;
  checklistTotal: number;
  files: string[];
  note?: string | null;
};

type EmailResult =
  | { sent: true; id?: string }
  | { sent: false; reason: string };

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const duration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${hours}h ${minutes}min ${remainingSeconds}s`;
};

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);

const isPaymentAgenda = (title: string) => {
  const normalized = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalized.includes("agenda de pagamento") ||
    normalized.includes("agenda pagamentos")
  );
};

function buildFileRows(files: string[]) {
  if (!files.length) {
    return `
      <tr>
        <td style="padding:16px 18px;border:1px solid #e8edf5;border-radius:12px;background:#f8fafc;color:#64748b;font-size:14px;">
          Nenhum documento foi anexado a esta atividade.
        </td>
      </tr>
    `;
  }

  return files
    .map(
      (file) => `
        <tr>
          <td style="padding:0 0 10px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
              <tr>
                <td style="padding:14px 16px;border:1px solid #e5eaf2;border-radius:12px;background:#ffffff;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td width="34" valign="middle" style="font-size:20px;">📄</td>
                      <td valign="middle" style="font-size:14px;line-height:20px;color:#1e293b;font-weight:700;">
                        ${esc(file)}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `,
    )
    .join("");
}

function buildSummaryCard(input: CompletionInput) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border-collapse:separate;">
      <tr>
        <td style="padding:20px;border:1px solid #e3e9f2;border-radius:14px;background:#f8fafc;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td colspan="2" style="padding:0 0 14px 0;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;font-weight:800;">
                Resumo da execução
              </td>
            </tr>
            <tr>
              <td width="50%" valign="top" style="padding:0 12px 14px 0;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">Cliente</div>
                <div style="margin-top:4px;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${esc(input.clientName)}</div>
              </td>
              <td width="50%" valign="top" style="padding:0 0 14px 12px;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">Responsável</div>
                <div style="margin-top:4px;font-size:14px;line-height:20px;color:#0f172a;font-weight:700;">${esc(input.responsibleName)}</div>
              </td>
            </tr>
            <tr>
              <td width="50%" valign="top" style="padding:0 12px 0 0;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">Tempo líquido</div>
                <div style="margin-top:4px;font-size:14px;color:#0f172a;font-weight:700;">${duration(input.totalSeconds)}</div>
              </td>
              <td width="50%" valign="top" style="padding:0 0 0 12px;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;">Checklist</div>
                <div style="margin-top:4px;font-size:14px;color:#0f172a;font-weight:700;">${input.checklistDone} de ${input.checklistTotal} concluídos</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildPaymentAgendaContent() {
  return `
    <p style="margin:0 0 18px 0;font-size:15px;line-height:24px;color:#334155;">
      Segue a relação dos pagamentos lançados no <strong>Conta Azul</strong> e dos
      agendamentos pendentes para aprovação na plataforma bancária.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
      <tr>
        <td style="padding:16px 18px;border-radius:12px;background:#eff6ff;border:1px solid #bfdbfe;">
          <div style="font-size:13px;color:#1d4ed8;font-weight:800;margin-bottom:5px;">⏰ APROVAÇÃO NECESSÁRIA</div>
          <div style="font-size:15px;line-height:23px;color:#1e3a8a;">
            As autorizações dos agendamentos deverão ser realizadas <strong>hoje, até às 16:00h</strong>.
          </div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
      <tr>
        <td style="padding:16px 18px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;">
          <div style="font-size:13px;color:#c2410c;font-weight:800;margin-bottom:5px;">⚠️ EVITE ENCARGOS E RETRABALHO</div>
          <div style="font-size:15px;line-height:23px;color:#7c2d12;">
            Evite o pagamento desnecessário de encargos e multas para sua empresa, além do retrabalho na operação financeira.
          </div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px 0;">
      <tr>
        <td style="padding:16px 18px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
          <div style="font-size:13px;color:#334155;font-weight:800;margin-bottom:5px;">📅 JANELA DE PAGAMENTOS</div>
          <div style="font-size:15px;line-height:23px;color:#475569;">
            Conforme contrato vigente, a equipe Fortuno executa a operação duas vezes por semana. Fique atento às datas definidas para sua janela de pagamentos.
          </div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
      <tr>
        <td style="padding:16px 18px;border-radius:12px;background:#fef2f2;border:1px solid #fecaca;">
          <div style="font-size:13px;color:#b91c1c;font-weight:800;margin-bottom:5px;">💰 ATENÇÃO AO SALDO BANCÁRIO</div>
          <div style="font-size:15px;line-height:23px;color:#7f1d1d;">
            O saldo da conta é de <strong>responsabilidade do cliente</strong>. Antes de aprovar, confirme se há saldo suficiente para pagar todos os boletos agendados.
          </div>
        </td>
      </tr>
    </table>

    <div style="font-size:13px;color:#1e3a8a;font-weight:800;letter-spacing:.4px;margin:0 0 10px 0;">📊 RELATÓRIOS E LEGENDA</div>

    <p style="margin:0 0 12px 0;font-size:14px;line-height:22px;color:#475569;">
      Também foram disponibilizados os relatórios atualizados sobre a relação mensal de pagamentos e os pagamentos em atraso, quando houver.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;border-collapse:separate;">
      <tr>
        <td style="padding:14px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:4px 0;font-size:14px;color:#334155;"><strong>✅ Pago</strong></td></tr>
            <tr><td style="padding:4px 0;font-size:14px;color:#334155;"><strong>⚠️ Em aberto</strong></td></tr>
            <tr><td style="padding:4px 0;font-size:14px;color:#334155;"><strong>⏰ Agendado</strong></td></tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

function buildGenericContent(input: CompletionInput) {
  return `
    <p style="margin:0 0 22px 0;font-size:15px;line-height:24px;color:#334155;">
      A atividade <strong>${esc(input.title)}</strong> foi concluída com sucesso pela equipe da Fortuno Gestão Financeira.
    </p>
  `;
}

function buildHtml(input: CompletionInput, activityUrl: string) {
  const agenda = isPaymentAgenda(input.title);
  const logoUrl = process.env.FORTUNO_LOGO_URL?.trim();
  const filesRows = buildFileRows(input.files);
  const noteHtml = input.note
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
        <tr>
          <td style="padding:16px 18px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
            <div style="font-size:12px;color:#64748b;font-weight:800;text-transform:uppercase;margin-bottom:7px;">Observação da equipe</div>
            <div style="font-size:14px;line-height:22px;color:#334155;">${esc(input.note).replaceAll("\n", "<br>")}</div>
          </td>
        </tr>
      </table>
    `
    : "";

  const logo = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="Fortuno Gestão Financeira" width="210" style="display:block;width:210px;max-width:100%;height:auto;border:0;margin:0 auto;">`
    : `
      <div style="font-size:32px;line-height:36px;letter-spacing:5px;color:#163b75;font-weight:300;">FORTUNO</div>
      <div style="margin-top:4px;font-size:9px;letter-spacing:3px;color:#94a3b8;font-weight:700;">GESTÃO FINANCEIRA</div>
    `;

  const cta = activityUrl
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 4px 0;">
        <tr>
          <td align="center">
            <a href="${esc(activityUrl)}" style="display:inline-block;background:#163b75;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:14px 24px;border-radius:10px;">Baixar documentos da tarefa</a>
          </td>
        </tr>
      </table>
      <p style="margin:10px 0 0 0;text-align:center;font-size:12px;line-height:18px;color:#94a3b8;">O acesso será realizado com segurança pelo Fortuno Hub.</p>
    `
    : "";

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(input.title)} concluída</title>
  </head>
  <body style="margin:0;padding:0;background:#f2f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(input.title)} concluída para ${esc(input.clientName)}.</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f5f9;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:34px 32px 26px 32px;background:#ffffff;">${logo}</td>
            </tr>
            <tr><td style="padding:0 32px;"><div style="height:1px;background:#edf1f6;"></div></td></tr>
            <tr>
              <td align="center" style="padding:28px 32px 10px 32px;">
                <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#ecfdf3;color:#15803d;font-size:11px;font-weight:800;letter-spacing:.8px;">✓ PROCESSO CONCLUÍDO</div>
                <h1 style="margin:14px 0 8px 0;font-size:26px;line-height:34px;color:#102a56;">${esc(input.title)}</h1>
                <p style="margin:0;font-size:13px;line-height:20px;color:#64748b;">Finalizada em ${esc(formatDateTime(input.completedAt))}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 32px 30px 32px;">
                <p style="margin:0 0 18px 0;font-size:15px;line-height:24px;color:#334155;">Prezado(a) cliente,</p>
                ${agenda ? buildPaymentAgendaContent() : buildGenericContent(input)}
                ${buildSummaryCard(input)}
                ${noteHtml}
                <div style="font-size:13px;color:#1e3a8a;font-weight:800;letter-spacing:.4px;margin:0 0 12px 0;">📎 DOCUMENTOS DISPONÍVEIS PARA DOWNLOAD</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filesRows}</table>
                ${cta}
                <p style="margin:26px 0 0 0;font-size:14px;line-height:22px;color:#475569;">Qualquer dúvida, nossa equipe permanece à disposição.</p>
                <p style="margin:22px 0 0 0;font-size:14px;line-height:22px;color:#334155;">Obrigado,<br><strong style="color:#102a56;">Fortuno Gestão Financeira</strong><br><span style="color:#64748b;">(61) 99109-7306</span></p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 24px;background:#f8fafc;border-top:1px solid #edf1f6;">
                <p style="margin:0;font-size:11px;line-height:18px;color:#94a3b8;">Este e-mail foi enviado automaticamente pelo Fortuno Hub.<br>Baixe seus arquivos com segurança.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText(input: CompletionInput, activityUrl: string) {
  const agenda = isPaymentAgenda(input.title);
  const files = input.files.length ? input.files.map((file) => `- ${file}`).join("\n") : "Nenhum documento anexado.";
  const agendaText = agenda
    ? `
As autorizações dos agendamentos deverão ser realizadas hoje, até às 16:00h.

Evite encargos, multas e retrabalho realizando as aprovações dentro do prazo.

Conforme contrato vigente, a equipe Fortuno executa a operação duas vezes por semana. Fique atento à sua janela de pagamentos.

Atenção: o saldo da conta é de responsabilidade do cliente. Confirme se há saldo suficiente para pagar todos os boletos agendados.

Legenda:
✅ Pago
⚠️ Em aberto
⏰ Agendado
`
    : `A atividade foi concluída com sucesso pela equipe Fortuno Gestão Financeira.`;

  return `
FORTUNO GESTÃO FINANCEIRA

PROCESSO CONCLUÍDO
${input.title}

Prezado(a) cliente,

${agendaText}

Cliente: ${input.clientName}
Responsável: ${input.responsibleName}
Finalização: ${formatDateTime(input.completedAt)}
Tempo líquido: ${duration(input.totalSeconds)}
Checklist: ${input.checklistDone} de ${input.checklistTotal}

${input.note ? `Observação:\n${input.note}\n` : ""}

Documentos disponíveis:
${files}

${activityUrl ? `Baixe os documentos da tarefa:\n${activityUrl}\n` : ""}

Qualquer dúvida, estamos à disposição.

Fortuno Gestão Financeira
(61) 99109-7306

Mensagem automática do Fortuno Hub.
`.trim();
}

export async function sendOperationCompletionEmail(input: CompletionInput): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { sent: false, reason: "RESEND_API_KEY não configurada." };

  const from =
    process.env.OPERATIONS_FROM_EMAIL?.trim() ||
    process.env.SUPPORT_FROM_EMAIL?.trim() ||
    "Fortuno Hub <onboarding@resend.dev>";

  const recipients = input.to.map((email) => email.trim()).filter(Boolean);
  if (!recipients.length) return { sent: false, reason: "Cliente sem e-mail operacional cadastrado." };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const activityUrl = appUrl ? `${appUrl}/operacoes?atividade=${encodeURIComponent(input.activityId)}` : "";
  const paymentAgenda = isPaymentAgenda(input.title);
  const subject = paymentAgenda
    ? `⏰ Agenda de Pagamentos concluída — ação necessária até às 16:00 | ${input.clientName}`
    : `✅ ${input.title} concluída — ${input.clientName}`;

  const html = buildHtml(input, activityUrl);
  const text = buildText(input, activityUrl);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `operation-complete-${input.activityId}`,
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html,
        text,
        tags: [
          { name: "module", value: "operations" },
          { name: "event", value: "activity_completed" },
          { name: "process", value: paymentAgenda ? "payment_agenda" : "generic" },
        ],
      }),
    });

    const payload = (await response.json()) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      return {
        sent: false,
        reason: payload.message || payload.name || `Resend respondeu com status ${response.status}.`,
      };
    }

    return { sent: true, id: payload.id };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : "Falha desconhecida no envio.",
    };
  }
}