import React from 'react';

interface StatusBadgeProps {
  label: string;
  status: 'ready' | 'pending' | 'active';
}

export function StatusBadge({ label, status }: StatusBadgeProps) {
  const statusStyles = {
    ready: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    active: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
