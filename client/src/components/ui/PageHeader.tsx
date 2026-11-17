import React from 'react';

// Cabecalho de pagina: trilha opcional, titulo (display), subtitulo e acoes a direita.
interface PageHeaderProps {
  breadcrumb?: string;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ breadcrumb, title, subtitle, actions }) => (
  <header className="flex w-full flex-wrap items-end justify-between gap-4">
    <div className="flex flex-col gap-1">
      {breadcrumb && <span className="text-label font-semibold uppercase text-ink-400">{breadcrumb}</span>}
      <h1 className="text-display font-bold text-ink-900">{title}</h1>
      <p className="text-body text-ink-600">{subtitle}</p>
    </div>
    {actions && <div className="flex items-center gap-3">{actions}</div>}
  </header>
);

export default PageHeader;
