import React from 'react';

// Define as propriedades que o InputField pode receber
interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  type?: 'text' | 'password' | 'email'; 
  error?: string; // Para exibir mensagens de erro de validação
}

const InputField: React.FC<InputFieldProps> = ({ 
  label, 
  id, 
  type = 'text', 
  error, 
  ...rest 
}) => {
  
  // Classes base Tailwind para o input
  const baseClasses = "mt-1 block w-full px-3 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none transition duration-150 ease-in-out sm:text-sm text-white";
  
  // Classes para estado normal e de erro
  const styleClasses = error 
    ? "border-red-500 focus:ring-red-500 focus:border-red-500" 
    : "border-gray-300 focus:ring-indigo-500 focus:border-indigo-500";
    
  return (
    <div className="input-field-container">
      <label htmlFor={id} className="block text-sm font-medium text-white">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        className={`${baseClasses} ${styleClasses}`}
        {...rest} 
      />
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default InputField;
