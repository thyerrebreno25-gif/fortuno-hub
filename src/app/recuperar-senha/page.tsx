"use client";

import Image from "next/image";
import { FortunoWordmark } from "@/components/fortuno-brand";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconArrowLeft,
  IconAt,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconShieldCheck,
} from "@tabler/icons-react";
import {RECOVERY_INTENT_COOKIE} from "@/lib/auth/recovery-return";
import { recoveryPasswordToken } from "@/lib/auth/recovery-password-token";
import loginStyles from "@/app/login/login.module.css";
import styles from "./recuperar-senha.module.css";

type RecoveryMode =
  | "request"
  | "sent"
  | "password"
  | "success"
  | "invalid";

export default function RecoverPasswordPage() {
  const router = useRouter();

  const [mode, setMode] = useState<RecoveryMode>("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const recoveryToken = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    // Read and clear the browser URL after hydration, without consuming its token.
    queueMicrotask(() => {
      if (!active) return;
      const currentUrl = new URL(window.location.href);
      const hasPayload = Boolean(currentUrl.search || currentUrl.hash);
      if (!hasPayload) return;
      const token = recoveryPasswordToken(currentUrl.href);
      recoveryToken.current = token;
      document.cookie=`${RECOVERY_INTENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
      window.history.replaceState({}, document.title, window.location.pathname);
      if (token) setMode("password");
      else {
        setError("O link de recuperação é inválido, expirou ou pertence ao fluxo antigo. Solicite um novo e-mail para continuar.");
        setMode("invalid");
      }
    });
    return () => { active = false; };
  }, []);

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setLoading(true);
    setError("");
    document.cookie=`${RECOVERY_INTENT_COOKIE}=1; Path=/; Max-Age=3600; SameSite=Lax; Secure`;
    try {
      const response=await fetch("/api/auth/password-recovery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:normalizedEmail})});
      const result=await response.json();
      if(!response.ok){setError(result.error || "Não foi possível solicitar o e-mail agora. Tente novamente em alguns instantes.");return;}
      setEmail(normalizedEmail);
      setMode("sent");
    } catch {setError("Não foi possível conectar ao envio de e-mail. Confira a conexão e tente novamente.");}
    finally {setLoading(false);}
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (password.length < 8 || password.length > 128) {
      setError("A nova senha deve possuir de 8 a 128 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("A confirmação da senha não confere.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/password-recovery/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenHash: recoveryToken.current, password }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "Não foi possível atualizar a senha.");
        if (result.invalidLink) { recoveryToken.current = null; setMode("invalid"); }
        return;
      }
      recoveryToken.current = null;
      setPassword(""); setConfirmPassword("");
      setMode("success");
    } catch {
      setError("Não foi possível confirmar a alteração. Solicite um novo link antes de tentar novamente.");
      recoveryToken.current = null;
      setMode("invalid");
    } finally { setLoading(false); }
  }

  const currentStep = mode === "request" || mode === "sent" ? 1 : mode === "success" ? 3 : 2;

  return (
    <main className={loginStyles.page}>
      <section className={loginStyles.brandPanel}>
        <div className={loginStyles.backgroundGrid} />
        <div className={loginStyles.backgroundGlow} />
        <div className={loginStyles.decorativeCircles} />

        <div className={loginStyles.brandContent}>
          <div className={loginStyles.fortunoBrand}><FortunoWordmark className={loginStyles.brandWordmark}/></div>


          <div className={loginStyles.securityStatus}>
            <div className={loginStyles.shieldIcon}>
              <IconShieldCheck aria-hidden="true" />
            </div>
            <span>Recuperação protegida de acesso</span>
          </div>
        </div>
      </section>

      <section className={loginStyles.loginSide}>
        <div className={`${loginStyles.loginCard} ${styles.card}`}>
          <header className={loginStyles.convertNowHeader}>
            <div className={loginStyles.convertNowLogo}>
              <Image
                src="/brand/fortuno-icon-blue.png"
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
                  Enviaremos um link seguro para criar uma nova senha. Você não precisa
                  do código do autenticador para redefini-la.
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

          {mode === "password" && (
            <>
              <div className={loginStyles.welcome}>
                <span>ÚLTIMA ETAPA</span>
                <h1>Crie a nova senha</h1>
                <p>Use de 8 a 128 caracteres e confirme a senha abaixo.</p>
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
