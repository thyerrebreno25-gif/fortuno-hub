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

Sources: https://developers.google.com/workspace/chat/upload-media-attachments and https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/create
