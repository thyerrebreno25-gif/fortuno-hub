import type { Route } from "next";
import Link from "next/link";
import {
  Activity,
  Building2,
  CreditCard,
  Headphones,
  History,
  Landmark,
  LayoutDashboard,
  Rocket,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  ["Dashboard", "/dashboard", LayoutDashboard],
  ["Conversão de Moedas", "/conversao-moedas", WalletCards],
  ["Extratos → OFX", "/extratos", Landmark],
  ["Adquirentes", "/adquirentes", Activity],
  ["Faturas", "/faturas", CreditCard],
  ["Clientes", "/clientes", Building2],
  ["Onboarding", "/onboarding", Rocket],
  ["Histórico", "/historico", History],
  ["Suporte", "/suporte", Headphones],
  ["Configurações", "/configuracoes", Settings],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>CN</span>
          <div>
            <strong>ConvertNow</strong>
            <small>Financial intelligence</small>
          </div>
        </div>

        <nav>
          {navigation.map(([label, href, Icon]) => (
            <Link key={href} href={href as Route}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <Users size={18} />
          <div>
            <strong>Ambiente corporativo</strong>
            <small>Organização ativa</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">CONVERTNOW</span>
            <strong>Central de processamento financeiro</strong>
          </div>
          <div className="status-dot">Sistema online</div>
        </header>

        {children}
      </main>
    </div>
  );
}
