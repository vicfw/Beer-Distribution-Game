import type { LinkStatus } from './useGameSession';

const COPY: Partial<Record<LinkStatus, string>> = {
  connecting: 'Establishing uplink…',
  reconnecting: 'Link lost. Reconnecting. Your station stays on screen.',
  offline: 'Network unavailable. A queued order will transmit when the link returns.',
};

export function ConnectionBanner({ link, onRetry }: { link: LinkStatus; onRetry?: () => void }) {
  const message = COPY[link];
  if (!message) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border border-amber/40 bg-amber/10 px-4 py-2 font-mono text-xs tracking-wide text-amber"
    >
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="border border-amber/50 px-2 py-1 text-ink" onClick={onRetry}>
          Retry link
        </button>
      ) : null}
    </div>
  );
}

export function ReplacedOverlay({ onTakeControl }: { onTakeControl: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-void/80 px-4">
      <div className="w-full max-w-md border border-alert bg-panel p-6">
        <p className="font-mono text-[11px] tracking-[0.28em] text-alert">SESSION TRANSFERRED</p>
        <h2 className="mt-3 text-2xl">This seat is live in another tab.</h2>
        <p className="mt-2 text-sm text-muted">Taking control here disconnects the other tab. Your role and orders stay on the server.</p>
        <button type="button" className="mt-6 bg-cyan px-4 py-2 font-mono text-xs tracking-[0.18em] text-void" onClick={onTakeControl}>
          TAKE CONTROL HERE
        </button>
      </div>
    </div>
  );
}
