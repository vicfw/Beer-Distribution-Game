import type { ReactNode } from 'react';

export function HudFrame({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`relative border border-line bg-panel/85 p-5 ${className}`}>
      <span className="absolute left-0 top-0 h-2.5 w-2.5 border-l border-t border-cyan" />
      <span className="absolute right-0 top-0 h-2.5 w-2.5 border-r border-t border-cyan" />
      <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l border-cyan" />
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r border-cyan" />
      <p className="font-mono text-[11px] tracking-[0.28em] text-muted">{label}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto min-h-screen max-w-6xl px-4 py-6">
      <header className="flex items-center justify-between font-mono text-[11px] tracking-[0.28em] text-muted">
        <span>BDG / SECTOR CONTROL</span>
        <span>SUPPLY CHAIN SIM</span>
      </header>
      {children}
    </div>
  );
}
