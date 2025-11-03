import React from 'react';


// Define as propriedades que o Button pode receber
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  isLoading?: boolean; // Estado para exibir spinner de carregamento
  variant?: 'primary' | 'secondary' | 'danger'; // Variações de estilo
}

const Button: React.FC<ButtonProps> = ({ 
  children, 
  isLoading = false, 
  variant = 'primary', 
  disabled,
  ...rest 
}) => {
  
  // Classes base Tailwind
  const baseClasses = "w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium transition duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2";

  // Variações de estilo (cores)
  let variantClasses = '';
  switch (variant) {
    case 'secondary':
      variantClasses = 'bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-500';
      break;
    case 'danger':
      variantClasses = 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500';
      break;
    case 'primary':
    default:
      variantClasses = 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500';
      break;
  }
  
  // Classes para estado desabilitado/carregando
  const stateClasses = (isLoading || disabled) 
    ? 'opacity-50 cursor-not-allowed' 
    : 'hover:scale-[1.01] active:scale-[0.99]'; 

  const classes = `${baseClasses} ${variantClasses} ${stateClasses}`;

  // Componente Spinner (SVG inline)
  const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );

  return (
    <button
      className={classes}
      type="submit" // Mudado o padrão para 'submit' para formulários
      disabled={isLoading || disabled} 
      {...rest}
    >
      {isLoading ? (
        <>
          <Spinner />
          <span>Carregando...</span>
        </>
      ) : (
        children // O conteúdo normal do botão
      )}
    </button>
  );
};

export default Button;
