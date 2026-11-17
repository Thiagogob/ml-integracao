import React from 'react';

// Mensagem de erro (alert/erro do redesenho): fundo status/danger-soft e texto status/danger.
const ErrorAlert: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex w-full items-center gap-2.5 rounded-md bg-danger-soft px-3.5 py-3 text-body text-danger" role="alert">
        <span className="font-semibold" aria-hidden="true">!</span>
        <span>{message}</span>
    </div>
);

export default ErrorAlert;
