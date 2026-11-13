import { expect, it } from "vitest";
import { recoveryPasswordToken } from "./recovery-password-token";
it("keeps an email recovery token for the password submission without exchanging it in the browser", () => {
  expect(recoveryPasswordToken("https://hub/recuperar-senha?token_hash=single-use-recovery-token&type=recovery")).toBe("single-use-recovery-token");
});
it("requires a fresh recovery token rather than a normal session, invite, failed or consumed legacy link", () => {
  for (const query of ["", "?recovery=1", "?code=legacy", "?token_hash=single-use-invite-token&type=invite", "#access_token=ordinary&refresh_token=session&type=recovery", "?token_hash=single-use-recovery-token&type=recovery&error_code=otp_expired", "?token_hash=short&type=recovery"])
    expect(recoveryPasswordToken("https://hub/recuperar-senha" + query)).toBeNull();
});
