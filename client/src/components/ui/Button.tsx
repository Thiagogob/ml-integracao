import React from 'react';

// Botao do redesenho: uma acao primaria (azul) por tela; as demais sao secundarias, com contorno.
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  isLoading?: boolean; // Estado para exibir spinner de carregamento
  // success e danger entraram com a tela de importacao: autorizar uma execucao
  // que toca ~980 anuncios e cancela-la no meio nao sao acoes neutras
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  size?: 'md' | 'lg'; // md: 8/14 de padding; lg: 12/20, usado nos botoes de largura total
  icon?: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  children,
  isLoading = false,
  variant = 'primary',
  size = 'md',
  icon,
  disabled,
  className = '',
  type = 'submit', // Mantido o padrao 'submit' para formularios
  ...rest
}) => {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md text-body font-semibold transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
  const sizes = size === 'lg' ? 'px-5 py-3' : 'px-3.5 py-2';
  const VARIANTES: Record<string, string> = {
    secondary: 'bg-surface-card text-ink-900 border border-line',
    success: 'bg-success text-white border border-success',
    danger: 'bg-surface-card text-danger border border-danger-soft',
    primary: 'bg-brand text-white border border-brand',
  };
  const variants = VARIANTES[variant] ?? VARIANTES.primary;
  const state = isLoading || disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90 cursor-pointer';

  const Spinner = () => (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  return (
    <button
      type={type}
      className={`${base} ${sizes} ${variants} ${state} ${className}`}
      disabled={isLoading || disabled}
      {...rest}
    >
      {isLoading ? (
        <>
          <Spinner />
          <span>Carregando...</span>
        </>
      ) : (
        <>
          {icon && <span aria-hidden="true">{icon}</span>}
          <span>{children}</span>
        </>
      )}
    </button>
  );
};

export default Button;
