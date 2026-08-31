import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLATFORM_FROM_EMAIL,
  resolvePlatformEmailFrom,
} from "./platform-sender";

describe("remetente dos e-mails da plataforma", () => {
  it("usa o primeiro remetente configurado", () => {
    expect(
      resolvePlatformEmailFrom(
        [
          "Fortuno Convites <convites@envios.fortunogestao.com.br>",
          "Fortuno Suporte <suporte@hubsuporte.shop>",
        ],
        { production: true },
      ),
    ).toBe("Fortuno Convites <convites@envios.fortunogestao.com.br>");
  });

  it("ignora remetentes de teste do Resend em produção", () => {
    expect(
      resolvePlatformEmailFrom(
        [
          "Fortuno Hub <onboarding@resend.dev>",
          "Fortuno Hub <notificacoes@hubsuporte.shop>",
        ],
        { production: true },
      ),
    ).toBe("Fortuno Hub <notificacoes@hubsuporte.shop>");
  });

  it("mantém o domínio de teste fora de produção", () => {
    expect(
      resolvePlatformEmailFrom(["Fortuno Hub <onboarding@resend.dev>"], {
        production: false,
      }),
    ).toBe("Fortuno Hub <onboarding@resend.dev>");
  });

  it("usa o domínio autenticado como fallback", () => {
    expect(resolvePlatformEmailFrom([], { production: true })).toBe(
      DEFAULT_PLATFORM_FROM_EMAIL,
    );
  });
});
