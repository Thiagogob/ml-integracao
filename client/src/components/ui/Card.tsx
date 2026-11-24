import React from 'react';

// Cartao base do redesenho: fundo branco, borda border/default, raio 12 e sombra leve.
interface CardProps {
  children: React.ReactNode;
  className?: string;
}

const Card: React.FC<CardProps> = ({ children, className = '' }) => (
  <div className={`bg-surface-card border border-line rounded-xl shadow-card ${className}`}>{children}</div>
);

export default Card;
