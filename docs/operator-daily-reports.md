# Daily operator reports

The 08:00 America/Sao_Paulo job sends a short greeting and a PDF attachment to the explicitly selected Google Chat space. It does not fall back to a plain-text report when PDF generation/upload fails. `GET /api/management/operator-report/pdf?day=YYYY-MM-DD` provides an authenticated download with the caller's current organization, team scope and export permission.

## Connect the destination

In Gestão > Relatório diário da equipe, choose Configurar entrega no Google Chat, connect the Google account, load its spaces, select the managers' space and save with delivery enabled. Connecting alone never activates sending. Changes after 08:00 take effect the next day. Master/Admin must have Management view/manage/export permissions. Managers can preview/export only their linked operators.

File uploads require user OAuth; incoming webhooks cannot upload the PDF. The Google consent screen requests `chat.messages.create` and `chat.spaces.readonly`, without message-reading or Gmail scopes. Messages are attributed by Google to the connected user and the OAuth application. Ensure the Google Chat API is enabled in the OAuth application's Google Cloud project.

The integration can use the already configured `GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET` and its existing redirect URI. Chat states have a `report-chat.` prefix; the calendar callback delegates only those states to Chat. Ordinary calendar authorization is unchanged. Separate encrypted Chat tokens are stored; calendar credentials are not overwritten.

A separate OAuth client is optional through `GOOGLE_CHAT_CLIENT_ID`, `GOOGLE_CHAT_CLIENT_SECRET` and `GOOGLE_CHAT_REDIRECT_URI`. Its default callback is `/api/management/operator-report/google/callback`. Register that exact HTTPS redirect in Google Cloud if using this separate client. The existing integration encryption key is required. Never paste credentials into logs or chat.

## Delivery consistency

The database freezes the report snapshot, greeting, generated PDF bytes and confirmed Google attachment reference. Workers claim a lease before uploading or sending. Retries reuse the same attachment and stable message request ID after an uncertain response. A destination revision change stops old deliveries; missing membership, export/module permissions or Google authorization stops delivery. Maximum eight attempts, five minutes apart, for yesterday only.

The PDF distinguishes daily recorded production from pending work at generation time. Open timers are excluded from confirmed time. PDFs and OAuth tokens stay in internal tables protected by the production RLS/revoke setup. PDF endpoints are private and never expose access tokens or upload references.

Existing webhook-only configurations are disabled by the additive migration until the Google connection/space is selected. Disabling delivery needs no working Google connection. No real messages are sent by the test suite.

## Manual delivery

Master/Admin with Management view/manage/export can use **Enviar agora** to send the selected past day's greeting and PDF to the saved space, at any hour. The saved destination is displayed next to the report; unsaved destination edits are not used. This works with automatic sending disabled and never consumes or changes the scheduled 08:00 delivery.

`POST /api/management/operator-report/send` accepts only `day`, a UUIDv4 `requestId`, and the saved configuration `revision`. It derives organization, requester and sender from authenticated server state, requires JSON from the same origin, and checks both requester/sender permissions. A changed destination requires refreshing before sending. The separate private `OperatorReportManualDelivery` table freezes each request's snapshot/PDF/attachment, serializes active manual sends per organization and leases attempts. Retrying an uncertain request reuses its Google message request ID and attachment; confirmed requests return success without sending again. A new deliberate click after confirmation creates a new independent delivery. Manual failures require clicking again (maximum eight attempts); the scheduled worker does not pick them up. No message contents, access tokens, PDF bytes or attachment references appear in the API response/audit.

Sources: https://developers.google.com/workspace/chat/upload-media-attachments and https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create
