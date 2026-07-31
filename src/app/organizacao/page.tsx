"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./organization.module.css";

function formatCnpj(value: string) {
  const numbers = value.replace(/\D/g, "").slice(0, 14);

  return numbers
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export default function OrganizationPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          document,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrorMessage(
          data.error ?? "Não foi possível criar a organização.",
        );
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setErrorMessage(
        "Não foi possível se comunicar com o servidor.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.logo}>CN</div>

          <div>
            <strong>ConvertNow</strong>
            <span>Configuração inicial</span>
          </div>
        </header>

        <div className={styles.introduction}>
          <span>ORGANIZAÇÃO</span>

          <h1>Configure seu ambiente</h1>

          <p>
            Cadastre a empresa responsável pelo ambiente do
            ConvertNow. Você será definido como usuário MASTER.
          </p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="name">
              Nome da organização
            </label>

            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Fortuno Gestão Financeira"
              minLength={3}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="document">
              CNPJ
              <small>Opcional</small>
            </label>

            <input
              id="document"
              value={document}
              onChange={(event) =>
                setDocument(formatCnpj(event.target.value))
              }
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
            />
          </div>

          {errorMessage && (
            <div className={styles.error} role="alert">
              {errorMessage}
            </div>
          )}

          <button type="submit" disabled={loading}>
            {loading
              ? "Criando organização..."
              : "Criar organização"}
          </button>
        </form>

        <footer>
          Esta configuração poderá ser complementada depois.
        </footer>
      </section>
    </main>
  );
}