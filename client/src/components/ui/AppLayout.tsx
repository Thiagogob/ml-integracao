import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { logout } from '../../services/authService';

// Barra lateral comum as telas autenticadas, com a acao Sair no rodape.
interface AppLayoutProps {
  children: React.ReactNode;
  gap?: 'md' | 'lg'; // Espaco vertical da area principal (20 na tela de vendas, 24 nas demais)
}

const itemBase = 'relative flex w-full items-center gap-2.5 rounded-md px-3 py-2.5 text-body';
const itemAtivo = 'bg-nav-active text-white font-semibold';
const itemInativo = 'text-nav-text hover:bg-nav-active';

const Indicador = () => (
  <span className="absolute -left-0.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-sm bg-brand" aria-hidden="true" />
);

const AppLayout: React.FC<AppLayoutProps> = ({ children, gap = 'lg' }) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-surface-page">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col gap-1 bg-nav-bg px-4 py-6">
        <div className="flex items-center gap-2.5 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-label font-semibold text-white">ML</div>
          <div className="flex flex-col">
            <span className="text-body font-semibold text-white">ML Integração</span>
            <span className="text-label font-semibold text-nav-text">Estoque e vendas</span>
          </div>
        </div>

        <div className="h-6" aria-hidden="true" />

        <nav className="flex flex-col gap-1">
          <NavLink to="/dashboard" className={({ isActive }) => `${itemBase} ${isActive ? itemAtivo : itemInativo}`}>
            {({ isActive }) => (
              <>
                {isActive && <Indicador />}
                <span className="font-semibold" aria-hidden="true">▦</span>
                <span>Visão geral</span>
              </>
            )}
          </NavLink>
          <NavLink to="/vendas" className={({ isActive }) => `${itemBase} ${isActive ? itemAtivo : itemInativo}`}>
            {({ isActive }) => (
              <>
                {isActive && <Indicador />}
                <span className="font-semibold" aria-hidden="true">☰</span>
                <span>Vendas e coleta</span>
              </>
            )}
          </NavLink>
          <NavLink to="/importar-estoque" className={({ isActive }) => `${itemBase} ${isActive ? itemAtivo : itemInativo}`}>
            {({ isActive }) => (
              <>
                {isActive && <Indicador />}
                <span className="font-semibold" aria-hidden="true">⬆</span>
                <span>Importar estoque</span>
              </>
            )}
          </NavLink>
        </nav>

        <div className="flex-1" aria-hidden="true" />

        <div className="flex items-center justify-between gap-2.5 rounded-md border border-nav-active px-3 py-2.5">
          <span className="text-body text-nav-text">Sessão ativa</span>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-sm bg-nav-active px-2.5 py-1.5 text-body font-semibold text-danger-soft hover:opacity-90 cursor-pointer"
          >
            Sair
          </button>
        </div>
      </aside>

      <main className={`flex min-w-0 flex-1 flex-col px-10 py-8 ${gap === 'md' ? 'gap-5' : 'gap-6'}`}>{children}</main>
    </div>
  );
};

export default AppLayout;
