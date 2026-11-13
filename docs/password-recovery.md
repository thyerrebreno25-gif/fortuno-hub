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
