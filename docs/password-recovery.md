# Password recovery configuration

Production Supabase Auth Site URL: `https://app.hubsuporte.shop`.
Allowed recovery redirects (keep other existing legitimate redirects):

- `https://app.hubsuporte.shop/recuperar-senha`
- `https://app.hubsuporte.shop/recuperar-senha?recovery=1`

The Reset Password email button must point directly to:

```html
<a href="{{ .SiteURL }}/recuperar-senha?token_hash={{ .TokenHash }}&amp;type=recovery">Redefinir minha senha</a>
```

This uses Supabase's single-use recovery token verified by `verifyOtp`, avoiding a PKCE verifier that exists only in the browser that requested the email. Keep provider expiry, rate limits and the existing authenticator challenge. Do not embed credentials or log real links. `/ativar-acesso` has a separate exchange and must not be intercepted by recovery routing.

Legacy Supabase Site URL codes are preserved before login/daily-session redirects. Expired links display a new-link request on the recovery screen.

For an end-to-end check, request a fresh email and stop after the authenticated recovery form (or existing MFA challenge) is visible. The account owner must enter and submit any new password themselves.

## Delivery from the Hub

The public form posts to `/api/auth/password-recovery`. Supabase's built-in mail service only delivers to Supabase organization team addresses, so it cannot serve Hub operators. The server uses the existing `RESEND_API_KEY`, verified platform sender, Supabase admin recovery-link generation and integration encryption key. No new provider credentials are exposed to the browser.

Requests use durable limits: 20 per IP / 15 minutes, 3 per recipient / hour, at least 60 seconds between recipient requests, and 100 total / hour. Responses do not disclose account existence. Recipient and IP identifiers are HMAC hashes. The shared database lease prevents duplicate sends, the retry queue reuses an encrypted single-use token and stable provider idempotency key, and encrypted token material is cleared on success. Retries stop after three attempts or fifteen minutes. Metadata is retained for up to seven days and removed on new requests. Only users with existing Hub membership receive email; no public signup or MFA bypass is added.

The management scheduler retries queued deliveries. Optional `PASSWORD_RECOVERY_APP_URL` overrides the canonical `https://app.hubsuporte.shop` origin, and `PASSWORD_RECOVERY_FROM_EMAIL` can select an existing verified sender. Never build a recovery link from a client-supplied Host header.
