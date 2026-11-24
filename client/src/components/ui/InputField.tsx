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
  const borda = error ? 'border-danger' : 'border-line focus:border-brand';

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-semibold text-ink-600">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        className={`w-full rounded-md border bg-surface-card px-3 py-2.5 text-body text-ink-900 placeholder-ink-400 focus:outline-none disabled:opacity-50 ${borda}`}
        {...rest}
      />
      {error && (
        <p className="text-label font-semibold text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default InputField;
