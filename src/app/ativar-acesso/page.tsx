"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "@/app/login/login.module.css";

type PageState =
  | "validating"
  | "ready"
  | "saving"
  | "success"
  | "invalid";

function getHashSession() {
  if (typeof window === "undefined") {
    return {
      accessToken: "",
      refreshToken: "",
    };
  }

  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);

  return {
    accessToken: params.get("access_token") ?? "",
    refreshToken: params.get("refresh_token") ?? "",
  };
}

export default function ActivateAccessPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [state, setState] = useState<PageState>("validating");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function prepareInviteSession() {
      setErrorMessage("");

      try {
        const currentUrl = new URL(window.location.href);
        const tokenHash =
          currentUrl.searchParams.get("token_hash");
        const tokenType =
          currentUrl.searchParams.get("type");

        if (tokenHash) {
          if (
            tokenType !== "invite" &&
            tokenType !== "recovery"
          ) {
            if (active) {
              setErrorMessage(
                "Este convite possui um formato inválido. Solicite um novo convite ao administrador.",
              );
              setState("invalid");
            }
            return;
          }

          const { error } =
            await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: tokenType,
            });

          if (error) {
            if (active) {
              setErrorMessage(
                "Este convite é inválido ou expirou. Solicite um novo convite ao administrador.",
              );
              setState("invalid");
            }
            return;
          }

          currentUrl.searchParams.delete("token_hash");
          currentUrl.searchParams.delete("type");
          window.history.replaceState(
            {},
            document.title,
            `${currentUrl.pathname}${currentUrl.search}`,
          );

          if (active) {
            setState("ready");
          }
          return;
        }

        const code = currentUrl.searchParams.get("code");

        if (code) {
          const { error } =
            await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            if (active) {
              setErrorMessage(
                "Este convite é inválido ou expirou. Solicite um novo convite ao administrador.",
              );
              setState("invalid");
            }
            return;
          }

          currentUrl.searchParams.delete("code");
          window.history.replaceState(
            {},
            document.title,
            `${currentUrl.pathname}${currentUrl.search}`,
          );

          if (active) {
            setState("ready");
          }
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          if (active) {
            setState("ready");
          }
          return;
        }

        const { accessToken, refreshToken } =
          getHashSession();

        if (accessToken && refreshToken) {
          const { error } =
            await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

          if (error) {
            if (active) {
              setErrorMessage(
                "Não foi possível validar este convite. Solicite um novo link de acesso.",
              );
              setState("invalid");
            }
            return;
          }

          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );

          if (active) {
            setState("ready");
          }
          return;
        }

        if (active) {
          setErrorMessage(
            "Este link de ativação não contém uma sessão válida. Solicite um novo convite ao administrador.",
          );
          setState("invalid");
        }
      } catch {
        if (active) {
          setErrorMessage(
            "Não foi possível validar seu convite. Tente novamente ou solicite um novo convite.",
          );
          setState("invalid");
        }
      }
    }

    void prepareInviteSession();

    return () => {
      active = false;
    };
  }, [supabase]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage(
        "A senha deve possuir pelo menos 8 caracteres.",
      );
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage(
        "A confirmação da senha não confere.",
      );
      return;
    }

    setState("saving");

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      setErrorMessage(
        error.message ||
          "Não foi possível criar sua senha.",
      );
      setState("ready");
      return;
    }

    setState("success");

    window.setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1200);
  }

  const loading =
    state === "validating" || state === "saving";

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel}>
        <div className={styles.backgroundGrid} />
        <div className={styles.backgroundGlow} />
        <div className={styles.decorativeCircles} />

        <div className={styles.brandContent}>
          <div className={styles.fortunoBrand}>
            <div className={styles.fortunoWord}>
              <span>F</span>

              <svg
                className={styles.fortunoO}
                viewBox="0 0 190 100"
                aria-label="O"
                role="img"
              >
                <defs>
                  <linearGradient
                    id="fortunoGradientActivate"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop
                      offset="0%"
                      stopColor="#285E9F"
                    />
                    <stop
                      offset="22%"
                      stopColor="#6798D0"
                    />
                    <stop
                      offset="46%"
                      stopColor="#D6A158"
                    />
                    <stop
                      offset="100%"
                      stopColor="#F5A13A"
                    />
                  </linearGradient>
                </defs>

                <path
                  d="M38 13 H138 C163 13 178 28 178 50 C178 72 163 87 138 87 H38 C19 87 8 76 8 60"
                  fill="none"
                  stroke="url(#fortunoGradientActivate)"
                  strokeWidth="9"
                  strokeLinecap="round"
                />

                <path
                  d="M8 40 C8 24 18 13 38 13"
                  fill="none"
                  stroke="#315D91"
                  strokeWidth="9"
                  strokeLinecap="round"
                />
              </svg>

              <span>R</span>
              <span>T</span>
              <span>U</span>
              <span>N</span>
              <span>O</span>
            </div>

            <div className={styles.fortunoSubtitle}>
              GESTÃO FINANCEIRA
            </div>
          </div>

          <div className={styles.securityStatus}>
            <div className={styles.shieldIcon}>
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M12 2.5 20 5.8v5.4c0 5.1-3.2 8.7-8 10.3-4.8-1.6-8-5.2-8-10.3V5.8L12 2.5Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="m8.5 12 2.2 2.2 4.8-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <span>
              Ativação segura de acesso
            </span>
          </div>
        </div>
      </section>

      <section className={styles.loginSide}>
        <div className={styles.loginCard}>
          <header
            className={styles.convertNowHeader}
          >
            <div
              className={styles.convertNowLogo}
            >
              <Image
                src="/fortuno-logo-v2.png"
                alt="Fortuno"
                width={56}
                height={56}
                priority
              />
            </div>

            <div>
              <strong>Fortuno Hub</strong>
              <span>
                Central de automação e gestão
                operacional
              </span>
            </div>
          </header>

          <div className={styles.welcome}>
            <span>PRIMEIRO ACESSO</span>

            <h1>Crie sua senha</h1>

            <p>
              Defina sua senha para concluir a
              ativação do acesso à plataforma.
            </p>
          </div>

          {state === "validating" ? (
            <div
              className={styles.errorMessage}
              role="status"
            >
              <strong>
                Validando seu convite...
              </strong>
              <span>
                Aguarde enquanto confirmamos seu
                acesso.
              </span>
            </div>
          ) : state === "invalid" ? (
            <>
              <div
                className={styles.errorMessage}
                role="alert"
              >
                <strong>
                  Não foi possível ativar o acesso.
                </strong>
                <span>{errorMessage}</span>
              </div>

              <button
                type="button"
                className={styles.submitButton}
                onClick={() =>
                  router.replace("/login")
                }
              >
                <span>Ir para o login</span>
                <span
                  className={styles.arrow}
                >
                  →
                </span>
              </button>
            </>
          ) : (
            <form
              className={styles.form}
              onSubmit={handleSubmit}
            >
              <div className={styles.field}>
                <label htmlFor="password">
                  Nova senha
                </label>

                <div
                  className={
                    styles.inputContainer
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <rect
                      x="4"
                      y="10"
                      width="16"
                      height="11"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M8 10V7a4 4 0 0 1 8 0v3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>

                  <input
                    id="password"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    value={password}
                    onChange={(event) =>
                      setPassword(
                        event.target.value,
                      )
                    }
                    placeholder="Mínimo de 8 caracteres"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    disabled={loading}
                  />

                  <button
                    type="button"
                    className={styles.eyeButton}
                    onClick={() =>
                      setShowPassword(
                        (current) => !current,
                      )
                    }
                    aria-label={
                      showPassword
                        ? "Ocultar senha"
                        : "Mostrar senha"
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="2.7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className={styles.field}>
                <label
                  htmlFor="confirmPassword"
                >
                  Confirmar senha
                </label>

                <div
                  className={
                    styles.inputContainer
                  }
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <rect
                      x="4"
                      y="10"
                      width="16"
                      height="11"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                    <path
                      d="M8 10V7a4 4 0 0 1 8 0v3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>

                  <input
                    id="confirmPassword"
                    type={
                      showPassword
                        ? "text"
                        : "password"
                    }
                    value={confirmPassword}
                    onChange={(event) =>
                      setConfirmPassword(
                        event.target.value,
                      )
                    }
                    placeholder="Digite novamente"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              {errorMessage && (
                <div
                  className={
                    styles.errorMessage
                  }
                  role="alert"
                >
                  <strong>
                    Revise sua senha.
                  </strong>
                  <span>{errorMessage}</span>
                </div>
              )}

              {state === "success" && (
                <div
                  className={
                    styles.errorMessage
                  }
                  role="status"
                >
                  <strong>
                    Acesso ativado com sucesso.
                  </strong>
                  <span>
                    Redirecionando para a
                    plataforma...
                  </span>
                </div>
              )}

              <button
                type="submit"
                className={
                  styles.submitButton
                }
                disabled={
                  loading ||
                  state === "success"
                }
              >
                {state === "saving" ? (
                  <>
                    <span
                      className={
                        styles.spinner
                      }
                    />
                    Criando senha...
                  </>
                ) : state === "success" ? (
                  <>
                    <span>
                      Acesso ativado
                    </span>
                    <span
                      className={
                        styles.arrow
                      }
                    >
                      ✓
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      Ativar meu acesso
                    </span>
                    <span
                      className={
                        styles.arrow
                      }
                    >
                      →
                    </span>
                  </>
                )}
              </button>
            </form>
          )}

          <footer className={styles.footer}>
            <span>
              © 2026 Fortuno Gestão Financeira
            </span>
            <span
              className={styles.footerDot}
            >
              •
            </span>
            <span>Fortuno Hub</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
