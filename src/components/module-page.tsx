import type { ReactNode } from "react";

export function ModulePage({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <section className="page"><div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children ?? <div className="empty-card"><strong>Módulo preparado</strong><p>Esta rota possui estrutura própria e será implementada sem alterar os demais módulos.</p></div>}</section>;
}
