"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import styles from "@/app/dashboard.module.css";
import { DashboardTopbar } from "@/components/dashboard/dashboard-topbar";
import { SessionTimeout } from "@/components/session/session-timeout";

type MenuItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  group: MenuGroup;
  moduleCode: string;
};

type MenuGroup =
  | "Visão geral"
  | "Financeiro"
  | "Operação"
  | "Análises"
  | "Administração";

const menuGroups: MenuGroup[] = [
  "Visão geral",
  "Financeiro",
  "Operação",
  "Análises",
  "Administração",
];

const icons = {
  home: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  ),

  notice: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  ),

  assistant: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3a7 7 0 0 0-7 7v3a4 4 0 0 0 4 4h1l2 3 2-3h1a4 4 0 0 0 4-4v-3a7 7 0 0 0-7-7Z" />
      <path d="M9 10h.01M15 10h.01M9.5 14h5" />
    </svg>
  ),

  audit: (
  <svg viewBox="0 0 24 24">
    <path d="M9 11l2 2 4-4" />
    <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
    <path d="M9 7h6" />
    <path d="M9 17h6" />
  </svg>
),

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

  whatsapp: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-4.7A8.5 8.5 0 1 1 20.5 11.5Z" />
      <path d="M8.2 7.8c.4 3.7 2.5 5.8 6.1 6.4l1.2-1.4 2 .9c-.4 1.8-1.7 2.7-3.5 2.5-4.2-.5-7.5-3.8-8.1-8-.2-1.8.7-3 2.4-3.5l1 2Z" />
    </svg>
  ),

  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  ),

  integration: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 12h8" />
      <path d="M10 8H7a4 4 0 0 0 0 8h3" />
      <path d="M14 8h3a4 4 0 0 1 0 8h-3" />
    </svg>
  ),
};

const menuItems: MenuItem[] = [
  { label: "Central de Reuniões", href: "/reunioes", moduleCode: "MEETINGS", icon: icons.users, group: "Operação" },
  { label: "Agenda", href: "/agenda", moduleCode: "CALENDAR", icon: icons.operations, group: "Operação" },
  {
    label: "Início",
    href: "/inicio",
    moduleCode: "__HOME__",
    icon: icons.home,
    group: "Visão geral",
  },
  {
    label: "Dashboard",
    href: "/dashboard",
    moduleCode: "DASHBOARD",
    icon: icons.dashboard,
    group: "Visão geral",
  },
  {
    label: "Avisos",
    href: "/avisos",
    moduleCode: "NOTICES",
    icon: icons.notice,
    group: "Visão geral",
  },
  {
    label: "Assistente",
    href: "/assistente",
    moduleCode: "ASSISTANT",
    icon: icons.assistant,
    group: "Visão geral",
  },
  {
    label: "Extratos",
    href: "/extratos",
    moduleCode: "IMPORTS",
    icon: icons.bank,
    group: "Financeiro",
  },
  {
    label: "Faturas",
    href: "/faturas",
    moduleCode: "IMPORTS",
    icon: icons.card,
    group: "Financeiro",
  },
  {
    label: "Notas de compra",
    href: "/notas-fiscais",
    moduleCode: "PURCHASE_INVOICES",
    icon: icons.document,
    group: "Financeiro",
  },
  {
    label: "Adquirentes",
    href: "/adquirentes",
    moduleCode: "IMPORTS",
    icon: icons.activity,
    group: "Financeiro",
  },
  {
    label: "Conferência de vendas",
    href: "/conferencia-vendas",
    moduleCode: "SALES_RECONCILIATION",
    icon: icons.audit,
    group: "Financeiro",
  },
  {
    label: "Clientes",
    href: "/clientes",
    moduleCode: "CLIENTS",
    icon: icons.users,
    group: "Operação",
  },
  {
    label: "WhatsApp",
    href: "/whatsapp",
    moduleCode: "WHATSAPP",
    icon: icons.whatsapp,
    group: "Operação",
  },
  {
    label: "Motor Cambial",
    href: "/motor-cambial",
    moduleCode: "MOTOR_EXCHANGE",
    icon: icons.currency,
    group: "Financeiro",
  },
  { label: "Mapeamento Operacional", href: "/mapeamento-operacional", moduleCode: "OPERATIONAL_MAPPING", icon: icons.activity, group: "Operação" },
  {
    label: "Onboarding",
    href: "/onboarding",
    moduleCode: "ONBOARDING",
    icon: icons.rocket,
    group: "Operação",
  },
  {
    label: "Auditoria",
    href: "/auditoria",
    moduleCode: "AUDIT",
    icon: icons.audit,
    group: "Operação",
  },
  {
    label: "Relatórios",
    href: "/relatorios",
    moduleCode: "REPORTS",
    icon: icons.report,
    group: "Análises",
  },
  {
    label: "Histórico",
    href: "/historico",
    moduleCode: "HISTORY",
    icon: icons.history,
    group: "Análises",
  },
  {
    label: "Suporte",
    href: "/suporte",
    moduleCode: "SUPPORT",
    icon: icons.support,
    group: "Administração",
  },
  {
    label: "Conta Azul",
    href: "/integracoes/conta-azul",
    moduleCode: "PURCHASE_INVOICES",
    icon: icons.integration,
    group: "Administração",
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    moduleCode: "SETTINGS",
    icon: icons.settings,
    group: "Administração",
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
    () =>
      menuItems.filter(
        (item) =>
          item.moduleCode === "__HOME__" ||
          permissions?.[item.moduleCode]?.canView !== false,
      ),
    [permissions],
  );

  const currentItem = menuItems.find((item) => isRouteActive(pathname, item.href));
  const currentAllowed =
    !currentItem ||
    currentItem.moduleCode === "__HOME__" ||
    permissions?.[currentItem.moduleCode]?.canView !== false;

  return (
    <div
      className={`${styles.app} ${
        sidebarCollapsed ? styles.sidebarCollapsed : ""
      }`}
    >
      <SessionTimeout />

      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoMark} aria-label="Fortuno">
  <svg
    className={styles.logoImage}
    viewBox="0 0 100 60"
    role="img"
    aria-hidden="true"
  >
    <defs>
      <linearGradient
        id="fortunoEmblemGradient"
        x1="0"
        y1="0"
        x2="1"
        y2="0"
      >
        <stop offset="0%" stopColor="#315D91" />
        <stop offset="38%" stopColor="#6798D0" />
        <stop offset="65%" stopColor="#D6A158" />
        <stop offset="100%" stopColor="#F5A13A" />
      </linearGradient>
    </defs>

    <path
      d="M18 10
         H70
         C84 10 92 18 92 30
         C92 42 84 50 70 50
         H18
         C9 50 4 45 4 37"
      fill="none"
      stroke="url(#fortunoEmblemGradient)"
      strokeWidth="5"
      strokeLinecap="round"
    />

    <path
      d="M4 23
         C4 15 9 10 18 10"
      fill="none"
      stroke="#315D91"
      strokeWidth="5"
      strokeLinecap="round"
    />
  </svg>
</div>

          <div className={styles.logoText}>
            <strong>Fortuno Hub</strong>
            <span>Gestão Operacional</span>
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

        <nav className={styles.navigation} aria-label="Menu principal">
          {menuGroups.map((group) => {
            const groupItems = visibleItems.filter(
              (item) => item.group === group,
            );

            if (groupItems.length === 0) return null;

            return (
              <section className={styles.menuGroup} key={group}>
                <span className={styles.menuSection}>{group}</span>

                <div className={styles.menuGroupItems}>
                  {groupItems.map((item) => {
                    const active = isRouteActive(pathname, item.href);

                    return (
                      <Link
                        key={item.href}
                        href={item.href as Route}
                        className={`${styles.menuItem} ${
                          active ? styles.menuItemActive : ""
                        }`}
                        aria-current={active ? "page" : undefined}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <span className={styles.menuIcon}>{item.icon}</span>
                        <span className={styles.menuLabel}>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
      </aside>

      <main className={styles.main}>
        <DashboardTopbar />

        <section className={styles.content}>
          {!permissionsLoaded ? (
            <div style={{ padding: 32 }}>Carregando permissões...</div>
          ) : currentAllowed ? (
            children
          ) : (
            <div style={{ maxWidth: 720, margin: "48px auto", padding: 32, border: "1px solid var(--fortuno-line)", borderRadius: 16, background: "var(--fortuno-surface)" }}>
              <h2 style={{ marginTop: 0 }}>Acesso não autorizado</h2>
              <p>Seu perfil não possui acesso a este módulo. Solicite a liberação a um administrador.</p>
              <Link href="/inicio">Voltar para Início</Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
