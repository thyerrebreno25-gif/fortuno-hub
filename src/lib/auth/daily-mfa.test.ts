import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDailyMfaToken, verifyDailyMfaToken } from "./daily-mfa";

const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-daily-mfa-secret-with-enough-entropy";
});

afterAll(() => {
  if (previousServiceRoleKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

describe("autorização diária do MFA", () => {
  const userId = "4fe7187d-3591-4ead-9056-dd1bc2553ca9";
  const morning = new Date("2026-08-24T12:00:00.000Z");

  it("é válida para o mesmo usuário durante o mesmo dia em São Paulo", async () => {
    const token = await createDailyMfaToken(userId, morning);
    await expect(
      verifyDailyMfaToken(token, userId, new Date("2026-08-25T02:59:00.000Z")),
    ).resolves.toBe(true);
  });

  it("expira na mudança do dia em São Paulo", async () => {
    const token = await createDailyMfaToken(userId, morning);
    await expect(
      verifyDailyMfaToken(token, userId, new Date("2026-08-25T03:01:00.000Z")),
    ).resolves.toBe(false);
  });

  it("não pode ser usado por outro usuário nem depois de adulterado", async () => {
    const token = await createDailyMfaToken(userId, morning);
    await expect(verifyDailyMfaToken(token, "outro-usuario", morning)).resolves.toBe(false);
    await expect(verifyDailyMfaToken(`${token}x`, userId, morning)).resolves.toBe(false);
  });
});
