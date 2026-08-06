"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "@/app/dashboard.module.css";
import { DashboardTopbar } from "@/components/dashboard/dashboard-topbar";

type MenuItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  section?: string;
  expandable?: boolean;
  moduleCode: string;
};

const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),

  bank: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9 12 4l9 5" />
      <path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7M3 20h18M2 17h20" />
    </svg>
  ),

  card: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8h4M7 12h2M13 12h4M7 16h4M15 16h2" />
    </svg>
  ),

  operations: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3z"/><path d="m8 12 2 2 5-5M8 18h8"/></svg>
  ),

  activity: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 12h4l2.2-7 4.2 14 2.3-7H22" />
    </svg>
  ),

  document: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 2h8l4 4v16H6z" />
      <path d="M14 2v5h5M9 12h6M9 16h6" />
    </svg>
  ),

  users: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14h1a4 4 0 0 1 4 4v2" />
    </svg>
  ),

  currency: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 8h5a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h5" />
      <path d="M12 6v12" />
    </svg>
  ),

  rocket: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3c3 1 5 4 6 7-2 0-4 1-6 3-2 2-3 4-3 6-3-1-6-3-7-6 2 0 4-1 6-3 2-2 3-4 4-7Z" />
      <circle cx="15.5" cy="8.5" r="1.2" />
      <path d="M5 19l-2 2 4-1-1-3z" />
    </svg>
  ),

  report: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),

  history: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6v5h5" />
      <path d="M5.5 16A8 8 0 1 0 4 11" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),

  support: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z" />
    </svg>
  ),

  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  ),
};

const menuItems: MenuItem[] = [
  {
  label: "Dashboard",
  href: "/dashboard",
    moduleCode: "DASHBOARD",
  icon: icons.dashboard,
},
  {
    label: "Extratos",
    href: "/extratos",
    moduleCode: "IMPORTS",
    icon: icons.bank,
    section: "IMPORTAÇÕES",
    expandable: true,
  },
  {
    label: "Faturas",
    href: "/faturas",
    moduleCode: "IMPORTS",
    icon: icons.card,
    expandable: true,
  },
  {
    label: "Adquirentes",
    href: "/adquirentes",
    moduleCode: "IMPORTS",
    icon: icons.activity,
    expandable: true,
  },
  {
    label: "BrasilMed",
    href: "/conciliacao-brasilmed",
    moduleCode: "IMPORTS",
    icon: icons.document,
    expandable: true,
  },
  {
    label: "Clientes",
    href: "/clientes",
    moduleCode: "CLIENTS",
    icon: icons.users,
    section: "CADASTROS",
  },
  {
  label: "Motor Cambial",
  href: "/motor-cambial",
    moduleCode: "MOTOR_EXCHANGE",
  icon: icons.currency,
  section: "CONVERSÕES",
},
  {
    label: "Operações",
    href: "/operacoes",
    moduleCode: "OPERATIONS",
    icon: icons.operations,
    section: "OPERAÇÃO",
  },
  {
    label: "Onboarding",
    href: "/onboarding",
    moduleCode: "ONBOARDING",
    icon: icons.rocket,
    section: "IMPLANTAÇÃO",
  },
  {
    label: "Relatórios",
    href: "/relatorios",
    moduleCode: "REPORTS",
    icon: icons.report,
    section: "RELATÓRIOS",
  },
  {
    label: "Histórico",
    href: "/historico",
    moduleCode: "HISTORY",
    icon: icons.history,
  },
  {
    label: "Suporte",
    href: "/suporte",
    moduleCode: "SUPPORT",
    icon: icons.support,
    section: "SUPORTE",
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    moduleCode: "SETTINGS",
    icon: icons.settings,
    section: "SISTEMA",
  },
];

function isRouteActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, { canView: boolean }> | null>(null);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/permissions/me", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Permissões indisponíveis.");
        if (active) setPermissions(payload.permissions ?? {});
      })
      .catch(() => {
        if (active) setPermissions({});
      })
      .finally(() => {
        if (active) setPermissionsLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const visibleItems = useMemo(
    () => menuItems.filter((item) => permissions?.[item.moduleCode]?.canView !== false),
    [permissions],
  );

  const currentItem = menuItems.find((item) => isRouteActive(pathname, item.href));
  const currentAllowed = !currentItem || permissions?.[currentItem.moduleCode]?.canView !== false;

  return (
    <div
      className={`${styles.app} ${
        sidebarCollapsed ? styles.sidebarCollapsed : ""
      }`}
    >
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoMark}>CN</div>

          <div className={styles.logoText}>
            <strong>ConvertNow</strong>
            <span>Financial Intelligence</span>
          </div>

          <button
            type="button"
            className={styles.collapseButton}
            onClick={() =>
              setSidebarCollapsed((current) => !current)
            }
            aria-label={
              sidebarCollapsed
                ? "Expandir menu"
                : "Recolher menu"
            }
          >
            ‹
          </button>
        </div>

        <nav className={styles.navigation}>
          {visibleItems.map((item) => {
            const active = isRouteActive(pathname, item.href);

            return (
              <div key={item.href}>
                {item.section && (
                  <span className={styles.menuSection}>
                    {item.section}
                  </span>
                )}

                <Link
  href={item.href as any}
  className={`${styles.menuItem} ${
    active ? styles.menuItemActive : ""
  }`}
  aria-current={active ? "page" : undefined}
>
                  <span className={styles.menuIcon}>
                    {item.icon}
                  </span>

                  <span className={styles.menuLabel}>
                    {item.label}
                  </span>

                  {item.expandable && (
                    <span className={styles.menuArrow}>›</span>
                  )}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className={styles.organizationCard}>
          <div className={styles.organizationAvatar}>N</div>

          <div className={styles.organizationText}>
            <strong>Ambiente corporativo</strong>
            <span>Organização ativa</span>
          </div>

          <span className={styles.organizationArrow}>›</span>
        </div>
      </aside>

      <main className={styles.main}>
        <DashboardTopbar />

        <section className={styles.content}>
          {!permissionsLoaded ? (
            <div style={{ padding: 32 }}>Carregando permissões...</div>
          ) : currentAllowed ? (
            children
          ) : (
            <div style={{ maxWidth: 720, margin: "48px auto", padding: 32, border: "1px solid #dce3ec", borderRadius: 16, background: "white" }}>
              <h2 style={{ marginTop: 0 }}>Acesso não autorizado</h2>
              <p>Seu perfil não possui acesso a este módulo. Solicite a liberação a um administrador.</p>
              <Link href="/clientes">Voltar para Clientes</Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}