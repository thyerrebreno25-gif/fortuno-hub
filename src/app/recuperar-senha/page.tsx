"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconAt,
  IconCheck,
  IconDeviceMobile,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconShieldCheck,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import loginStyles from "@/app/login/login.module.css";
import styles from "./recuperar-senha.module.css";

type RecoveryMode =
  | "request"
  | "sent"
  | "preparing"
  | "authenticator"
  | "password"
  | "success"
  | "invalid";

function recoveryTokens() {
  const currentUrl = new URL(window.location.href);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return {
    tokenHash: currentUrl.searchParams.get("token_hash") ?? "",
    tokenType: currentUrl.searchParams.get("type") ?? "",
    code: currentUrl.searchParams.get("code") ?? "",
    recovery: currentUrl.searchParams.get("recovery") === "1",
    accessToken: hash.get("access_token") ?? "",
    refreshToken: hash.get("refresh_token") ?? "",
    hashType: hash.get("type") ?? "",
  };
}

function friendlyMfaError(message: string) {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("invalid") ||
    normalized.includes("expired") ||
    normalized.includes("challenge")
  ) {
    return "Código inválido ou expirado. Confira o autenticador e tente novamente.";
  }
  return "Não foi possível validar o código do autenticador. Tente novamente.";
}

export default function RecoverPasswordPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [mode, setMode] = useState<RecoveryMode>("request");
  const [email, setEmail] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function prepareRecovery() {
      const tokens = recoveryTokens();
      const hasRecoveryPayload = Boolean(
        tokens.tokenHash ||
          tokens.code ||
          tokens.accessToken ||
          tokens.recovery ||
          tokens.hashType === "recovery",
      );
      if (!hasRecoveryPayload) return;

      setMode("preparing");
      setError("");

      try {
        if (tokens.tokenHash) {
          if (tokens.tokenType !== "recovery") {
            throw new Error("invalid-recovery-type");
          }
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokens.tokenHash,
            type: "recovery",
          });
          if (verifyError) throw verifyError;
        } else if (tokens.code) {
          const { error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(tokens.code);
          if (exchangeError) throw exchangeError;
        } else if (tokens.accessToken && tokens.refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          });
          if (sessionError) throw sessionError;
        }

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();
        if (userError || !user) throw userError || new Error("missing-user");

        const { data: factors, error: factorsError } =
          await supabase.auth.mfa.listFactors();
        if (factorsError || !factors) {
          throw factorsError || new Error("missing-factors");
        }

        const verifiedFactor = factors.totp.find(
          (factor) => factor.status === "verified",
        );
        if (!verifiedFactor) {
          if (active) {
            setError(
              "Esta conta não possui um autenticador confirmado. Solicite ao gestor a redefinição do acesso.",
            );
            setMode("invalid");
          }
          return;
        }

        window.history.replaceState(
          {},
          document.title,
          window.location.pathname,
        );

        if (active) {
          setEmail(user.email || "sua conta");
          setFactorId(verifiedFactor.id);
          setMode("authenticator");
        }
      } catch {
        if (active) {
          setError(
            "O link de recuperação é inválido ou expirou. Solicite um novo e-mail para continuar.",
          );
          setMode("invalid");
        }
      }
    }

    void prepareRecovery();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setLoading(true);
    setError("");
    const redirectTo = `${window.location.origin}/recuperar-senha?recovery=1`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      { redirectTo },
    );
    setLoading(false);

    if (resetError) {
      setError(
        "Não foi possível enviar o e-mail agora. Aguarde alguns instantes e tente novamente.",
      );
      return;
    }

    setEmail(normalizedEmail);
    setMode("sent");
  }

  async function verifyAuthenticator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
    if (normalizedCode.length !== 6 || !factorId) {
      setError("Informe os 6 números exibidos no aplicativo autenticador.");
      return;
    }

    setLoading(true);
    setError("");
    const { error: verifyError } =
      await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: normalizedCode,
      });
    setLoading(false);

    if (verifyError) {
      setError(friendlyMfaError(verifyError.message));
      return;
    }

    setMode("password");
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("A nova senha deve possuir pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("A confirmação da senha não confere.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      setError(
        updateError.message || "Não foi possível atualizar a senha desta conta.",
      );
      return;
    }

    await supabase.auth.signOut({ scope: "global" });
    setLoading(false);
    setMode("success");
  }

  const currentStep =
    mode === "request" || mode === "sent"
      ? 1
      : mode === "authenticator" || mode === "preparing" || mode === "invalid"
        ? 2
        : 3;

  return (
    <main className={loginStyles.page}>
      <section className={loginStyles.brandPanel}>
        <div className={loginStyles.backgroundGrid} />
        <div className={loginStyles.backgroundGlow} />
        <div className={loginStyles.decorativeCircles} />

        <div className={loginStyles.brandContent}>
          <div className={loginStyles.fortunoBrand}>
            <div className={loginStyles.fortunoWord}>
              <span>F</span>
              <svg
                className={loginStyles.fortunoO}
                viewBox="0 0 190 100"
                aria-label="O"
                role="img"
              >
                <defs>
                  <linearGradient id="recoveryGradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#285E9F" />
                    <stop offset="22%" stopColor="#6798D0" />
                    <stop offset="46%" stopColor="#D6A158" />
                    <stop offset="100%" stopColor="#F5A13A" />
                  </linearGradient>
                </defs>
                <path
                  d="M38 13 H138 C163 13 178 28 178 50 C178 72 163 87 138 87 H38 C19 87 8 76 8 60"
                  fill="none"
                  stroke="url(#recoveryGradient)"
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
              <span>R</span><span>T</span><span>U</span><span>N</span><span>O</span>
            </div>
            <div className={loginStyles.fortunoSubtitle}>GESTÃO FINANCEIRA</div>
          </div>

          <div className={loginStyles.securityStatus}>
            <div className={loginStyles.shieldIcon}>
              <IconShieldCheck aria-hidden="true" />
            </div>
            <span>Recuperação protegida em duas etapas</span>
          </div>
        </div>
      </section>

      <section className={loginStyles.loginSide}>
        <div className={`${loginStyles.loginCard} ${styles.card}`}>
          <header className={loginStyles.convertNowHeader}>
            <div className={loginStyles.convertNowLogo}>
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
              <span>Recuperação segura de acesso</span>
            </div>
          </header>

          <div className={styles.steps} aria-label={`Etapa ${currentStep} de 3`}>
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={step <= currentStep ? styles.stepActive : undefined}
              >
                {step < currentStep ? <IconCheck size={14} /> : step}
              </span>
            ))}
          </div>

          {mode === "request" && (
            <>
              <div className={loginStyles.welcome}>
                <span>RECUPERAR SENHA</span>
                <h1>Confirme seu e-mail</h1>
                <p>
                  Enviaremos um link seguro. Depois, confirme o código do seu
                  autenticador para criar uma nova senha.
                </p>
              </div>
              <form className={loginStyles.form} onSubmit={requestRecovery}>
                <div className={loginStyles.field}>
                  <label htmlFor="recovery-email">E-mail</label>
                  <div className={loginStyles.inputContainer}>
                    <IconAt aria-hidden="true" />
                    <input
                      id="recovery-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.currentTarget.value)}
                      placeholder="seuemail@empresa.com"
                      autoComplete="email"
                      required
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>
                {error && <RecoveryError message={error} />}
                <button
                  type="submit"
                  className={loginStyles.submitButton}
                  disabled={loading}
                >
                  {loading ? "Enviando..." : "Enviar link de confirmação"}
                </button>
              </form>
            </>
          )}

          {mode === "sent" && (
            <RecoveryMessage
              icon={<IconMail size={34} />}
              title="Confira seu e-mail"
              description={`Se ${email} estiver cadastrado, o link para continuar a recuperação chegará em alguns instantes.`}
            >
              <button
                type="button"
                className={loginStyles.submitButton}
                onClick={() => setMode("request")}
              >
                Reenviar e-mail
              </button>
            </RecoveryMessage>
          )}

          {mode === "preparing" && (
            <RecoveryMessage
              icon={<span className={loginStyles.spinner} />}
              title="Confirmando seu e-mail..."
              description="Aguarde enquanto validamos o link de recuperação."
            />
          )}

          {mode === "authenticator" && (
            <>
              <div className={loginStyles.welcome}>
                <span>SEGUNDA ETAPA</span>
                <h1>Confirme o autenticador</h1>
                <p>
                  Abra o aplicativo autenticador vinculado a {email} e informe
                  o código atual.
                </p>
              </div>
              <form className={loginStyles.form} onSubmit={verifyAuthenticator}>
                <div className={loginStyles.field}>
                  <label htmlFor="recovery-code">Código do autenticador</label>
                  <div className={`${loginStyles.inputContainer} ${styles.codeInput}`}>
                    <IconDeviceMobile aria-hidden="true" />
                    <input
                      id="recovery-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={code}
                      onChange={(event) =>
                        setCode(
                          event.currentTarget.value.replace(/\D/g, "").slice(0, 6),
                        )
                      }
                      placeholder="000000"
                      required
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>
                {error && <RecoveryError message={error} />}
                <button
                  type="submit"
                  className={loginStyles.submitButton}
                  disabled={loading || code.length !== 6}
                >
                  {loading ? "Validando..." : "Validar código"}
                </button>
              </form>
            </>
          )}

          {mode === "password" && (
            <>
              <div className={loginStyles.welcome}>
                <span>ÚLTIMA ETAPA</span>
                <h1>Crie a nova senha</h1>
                <p>Use pelo menos 8 caracteres e confirme a senha abaixo.</p>
              </div>
              <form className={loginStyles.form} onSubmit={savePassword}>
                <PasswordField
                  id="new-password"
                  label="Nova senha"
                  value={password}
                  onChange={setPassword}
                  showPassword={showPassword}
                  onToggle={() => setShowPassword((current) => !current)}
                  disabled={loading}
                  withToggle
                />
                <PasswordField
                  id="confirm-password"
                  label="Confirmar nova senha"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  showPassword={showPassword}
                  onToggle={() => setShowPassword((current) => !current)}
                  disabled={loading}
                />
                {error && <RecoveryError message={error} />}
                <button
                  type="submit"
                  className={loginStyles.submitButton}
                  disabled={loading}
                >
                  {loading ? "Salvando..." : "Atualizar minha senha"}
                </button>
              </form>
            </>
          )}

          {mode === "success" && (
            <RecoveryMessage
              icon={<IconCheck size={36} />}
              title="Senha atualizada"
              description="Sua nova senha já está ativa. Entre novamente para acessar o Fortuno Hub."
              success
            >
              <button
                type="button"
                className={loginStyles.submitButton}
                onClick={() => router.replace("/login")}
              >
                Voltar ao login
              </button>
            </RecoveryMessage>
          )}

          {mode === "invalid" && (
            <RecoveryMessage
              icon={<IconLock size={34} />}
              title="Não foi possível continuar"
              description={error}
            >
              <button
                type="button"
                className={loginStyles.submitButton}
                onClick={() => {
                  setError("");
                  setMode("request");
                }}
              >
                Solicitar novo link
              </button>
            </RecoveryMessage>
          )}

          {mode !== "success" && (
            <button
              type="button"
              className={styles.backButton}
              onClick={() => router.replace("/login")}
            >
              <IconArrowLeft size={16} />
              Voltar ao login
            </button>
          )}

          <footer className={loginStyles.footer}>
            <span>© 2026 Fortuno Gestão Financeira</span>
            <span className={loginStyles.footerDot}>•</span>
            <span>Fortuno Hub</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function RecoveryError({ message }: { message: string }) {
  return (
    <div className={loginStyles.errorMessage} role="alert">
      <strong>Não foi possível continuar.</strong>
      <span>{message}</span>
    </div>
  );
}

function RecoveryMessage({
  icon,
  title,
  description,
  success = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  success?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={styles.message} role="status">
      <span className={success ? styles.messageIconSuccess : styles.messageIcon}>
        {icon}
      </span>
      <h1>{title}</h1>
      <p>{description}</p>
      {children && <div className={styles.messageAction}>{children}</div>}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  showPassword,
  onToggle,
  disabled,
  withToggle = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggle: () => void;
  disabled: boolean;
  withToggle?: boolean;
}) {
  return (
    <div className={loginStyles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={loginStyles.inputContainer}>
        <IconLock aria-hidden="true" />
        <input
          id={id}
          type={showPassword ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Mínimo de 8 caracteres"
          autoComplete="new-password"
          minLength={8}
          required
          disabled={disabled}
        />
        {withToggle && (
          <button
            type="button"
            className={loginStyles.eyeButton}
            onClick={onToggle}
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
          >
            {showPassword ? <IconEyeOff /> : <IconEye />}
          </button>
        )}
      </div>
    </div>
  );
}
