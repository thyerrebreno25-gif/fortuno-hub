"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErrorMessage("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMessage(
        error.message === "Invalid login credentials"
          ? "E-mail ou senha incorretos."
          : error.message,
      );
      return;
    }

    router.replace("/mfa");
    router.refresh();
  }

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
                    id="fortunoGradient"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="#285E9F" />
                    <stop offset="22%" stopColor="#6798D0" />
                    <stop offset="46%" stopColor="#D6A158" />
                    <stop offset="100%" stopColor="#F5A13A" />
                  </linearGradient>
                </defs>

                <path
                  d="M38 13
                     H138
                     C163 13 178 28 178 50
                     C178 72 163 87 138 87
                     H38
                     C19 87 8 76 8 60"
                  fill="none"
                  stroke="url(#fortunoGradient)"
                  strokeWidth="9"
                  strokeLinecap="round"
                />

                <path
                  d="M8 40
                     C8 24 18 13 38 13"
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
              <svg viewBox="0 0 24 24" aria-hidden="true">
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

            <span>Ambiente seguro e monitorado</span>
          </div>
        </div>
      </section>

      <section className={styles.loginSide}>
        <div className={styles.loginCard}>
          <header className={styles.convertNowHeader}>
            <div className={styles.convertNowLogo}>
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
              <span>Central de automação e gestão operacional</span>
            </div>
          </header>

          <div className={styles.welcome}>
            <span>ACESSO À PLATAFORMA</span>

            <h1>Bem-vindo de volta</h1>

            <p>
              Entre com suas credenciais para acessar a central operacional.
            </p>
          </div>

          <form className={styles.form} onSubmit={handleLogin}>
            <div className={styles.field}>
              <label htmlFor="email">E-mail</label>

              <div className={styles.inputContainer}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M4 5.5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />

                  <path
                    d="m3 7 9 6 9-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>

                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seuemail@empresa.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label htmlFor="password">Senha</label>

              <div className={styles.inputContainer}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
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
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  required
                />

                <button
                  type="button"
                  className={styles.eyeButton}
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
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

            <div className={styles.options}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />

                <span className={styles.customCheckbox}>
                  {remember && "✓"}
                </span>

                <span>Permanecer conectado</span>
              </label>

              <button
                type="button"
                className={styles.forgotPassword}
                onClick={() => router.push("/recuperar-senha")}
              >
                Esqueci minha senha
              </button>
            </div>

            {errorMessage && (
              <div className={styles.errorMessage} role="alert">
                <strong>Não foi possível entrar.</strong>
                <span>{errorMessage}</span>
              </div>
            )}

            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className={styles.spinner} />
                  Entrando...
                </>
              ) : (
                <>
                  <span>Entrar na plataforma</span>
                  <span className={styles.arrow}>→</span>
                </>
              )}
            </button>
          </form>

          <footer className={styles.footer}>
            <span>© 2026 Fortuno Gestão Financeira</span>
            <span className={styles.footerDot}>•</span>
            <span>Fortuno Hub</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
