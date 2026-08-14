"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconCheck,
  IconCopy,
  IconDeviceMobile,
  IconLock,
  IconLogout,
  IconShieldCheck,
} from "@tabler/icons-react";
import { createClient } from "@/lib/supabase/client";
import styles from "./mfa.module.css";

type MfaMode = "loading" | "enroll" | "challenge";

type Enrollment = {
  qrCode: string;
  secret: string;
};

function friendlyError(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("invalid") ||
    normalized.includes("expired") ||
    normalized.includes("challenge")
  ) {
    return "Código inválido ou expirado. Confira o autenticador e tente novamente.";
  }

  return message;
}

export default function MfaPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const initialized = useRef(false);

  const [mode, setMode] = useState<MfaMode>("loading");
  const [email, setEmail] = useState("");
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  const initialize = useCallback(async () => {
    setError("");

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      router.replace("/login");
      return;
    }

    setEmail(user.email || "sua conta");

    const { data: factors, error: factorsError } =
      await supabase.auth.mfa.listFactors();

    if (factorsError || !factors) {
      setError(
        factorsError?.message ||
          "Não foi possível consultar o autenticador desta conta.",
      );
      return;
    }

    const verifiedFactor = factors.totp[0];

    if (verifiedFactor) {
      setFactorId(verifiedFactor.id);
      setMode("challenge");
      return;
    }

    const staleFactors = factors.all.filter(
      (factor) =>
        factor.factor_type === "totp" && factor.status === "unverified",
    );

    for (const factor of staleFactors) {
      const { error: removeError } = await supabase.auth.mfa.unenroll({
        factorId: factor.id,
      });

      if (removeError) {
        setError(
          "Não foi possível renovar o QR Code. Saia da conta e tente novamente.",
        );
        return;
      }
    }

    const { data: enrolled, error: enrollError } =
      await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `FortunoHub - ${user.email || user.id}`,
        issuer: "FortunoHub",
      });

    if (enrollError || !enrolled || enrolled.type !== "totp") {
      setError(
        enrollError?.message ||
          "Não foi possível gerar o QR Code do autenticador.",
      );
      return;
    }

    setFactorId(enrolled.id);
    setEnrollment({
      qrCode: enrolled.totp.qr_code,
      secret: enrolled.totp.secret,
    });
    setMode("enroll");
  }, [router, supabase]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initialize();
  }, [initialize]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedCode = code.replace(/\D/g, "").slice(0, 6);
    if (normalizedCode.length !== 6 || !factorId) {
      setError("Informe os 6 números exibidos no aplicativo autenticador.");
      return;
    }

    setVerifying(true);
    setError("");

    const { error: verifyError } =
      await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: normalizedCode,
      });

    if (verifyError) {
      setError(friendlyError(verifyError.message));
      setVerifying(false);
      return;
    }

    router.replace("/inicio");
    router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function copySecret() {
    if (!enrollment?.secret) return;

    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Não foi possível copiar. Selecione a chave manualmente.");
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <aside className={styles.brandPanel}>
          <div className={styles.brandGlow} />
          <div className={styles.brandMark}>F</div>
          <div className={styles.brandCopy}>
            <span>FORTUNO HUB</span>
            <h1>Seu acesso, agora mais protegido.</h1>
            <p>
              A autenticação em duas etapas impede o acesso mesmo que sua senha
              seja descoberta por outra pessoa.
            </p>
          </div>

          <div className={styles.securityNote}>
            <IconShieldCheck size={22} aria-hidden="true" />
            <div>
              <strong>Proteção individual</strong>
              <span>O autenticador fica vinculado somente a {email}.</span>
            </div>
          </div>
        </aside>

        <div className={styles.content}>
          {mode === "loading" ? (
            <div className={styles.loading} role="status">
              {error ? (
                <>
                  <IconLock size={34} aria-hidden="true" />
                  <strong>Não foi possível preparar o autenticador</strong>
                  <p>{error}</p>
                  <button
                    className={styles.retryButton}
                    type="button"
                    onClick={() => window.location.reload()}
                  >
                    Tentar novamente
                  </button>
                </>
              ) : (
                <>
                  <span className={styles.spinner} />
                  <strong>Preparando sua segurança...</strong>
                  <p>Estamos verificando o autenticador desta conta.</p>
                </>
              )}
            </div>
          ) : (
            <>
              <header className={styles.header}>
                <span className={styles.eyebrow}>
                  <IconLock size={15} aria-hidden="true" />
                  Verificação obrigatória
                </span>
                <h2>
                  {mode === "enroll"
                    ? "Conecte seu autenticador"
                    : "Digite o código de segurança"}
                </h2>
                <p>
                  {mode === "enroll"
                    ? "Faça esta configuração uma única vez. Nos próximos acessos, pediremos apenas o código de 6 números."
                    : `Abra o Google Authenticator no celular conectado a ${email}.`}
                </p>
              </header>

              {mode === "enroll" && enrollment && (
                <div className={styles.enrollment}>
                  <div className={styles.steps}>
                    <div><b>1</b><span>Abra o Google Authenticator.</span></div>
                    <div><b>2</b><span>Toque em + e escolha “Ler QR Code”.</span></div>
                    <div><b>3</b><span>Digite abaixo o código gerado.</span></div>
                  </div>

                  <div className={styles.qrArea}>
                    <div className={styles.qrFrame}>
                      <Image
                        src={enrollment.qrCode}
                        alt={`QR Code do autenticador para ${email}`}
                        width={184}
                        height={184}
                        unoptimized
                        priority
                      />
                    </div>
                    <div className={styles.manualSetup}>
                      <span>Não consegue ler o QR Code?</span>
                      <p>Use esta chave no cadastro manual:</p>
                      <button type="button" onClick={() => void copySecret()}>
                        <code>{enrollment.secret}</code>
                        {copied ? <IconCheck size={17} /> : <IconCopy size={17} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <form className={styles.form} onSubmit={verify}>
                <label htmlFor="mfa-code">Código do autenticador</label>
                <div className={styles.codeField}>
                  <IconDeviceMobile size={21} aria-hidden="true" />
                  <input
                    id="mfa-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(event) =>
                      setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="000000"
                    aria-describedby={error ? "mfa-error" : undefined}
                    autoFocus
                  />
                </div>

                {error && (
                  <p className={styles.error} id="mfa-error" role="alert">
                    {error}
                  </p>
                )}

                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={verifying || code.length !== 6}
                >
                  {verifying
                    ? "Verificando..."
                    : mode === "enroll"
                      ? "Ativar e entrar"
                      : "Confirmar e entrar"}
                </button>
              </form>
            </>
          )}

          <button className={styles.signOut} type="button" onClick={() => void signOut()}>
            <IconLogout size={17} aria-hidden="true" />
            Sair e usar outra conta
          </button>
        </div>
      </section>
    </main>
  );
}
