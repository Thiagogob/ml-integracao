import React from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

// Selo com ponto: fundo suave e texto escuro do mesmo tom (status/* e brand/* da paleta).
const TONES: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  success: { bg: 'bg-success-soft', fg: 'text-success', dot: 'bg-success' },
  warning: { bg: 'bg-warning-soft', fg: 'text-warning', dot: 'bg-warning' },
  danger: { bg: 'bg-danger-soft', fg: 'text-danger', dot: 'bg-danger' },
  neutral: { bg: 'bg-neutral-soft', fg: 'text-neutral', dot: 'bg-neutral' },
  info: { bg: 'bg-brand-soft', fg: 'text-brand-strong', dot: 'bg-brand-strong' },
};

interface BadgeProps {
  tone: BadgeTone;
  children: React.ReactNode;
}

const Badge: React.FC<BadgeProps> = ({ tone, children }) => {
  const t = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label font-semibold uppercase whitespace-nowrap ${t.bg} ${t.fg}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
};

export default Badge;
