import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function AppLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-mono text-[11px] tracking-[0.18em] text-cyan">
      {children}
    </Link>
  );
}
