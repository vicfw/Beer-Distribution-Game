import { ROLE_LABEL, ROLES, type Role } from '@beer-game/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppLink } from '../components/AppLink';
import { HudFrame, Shell } from '../components/HudFrame';
import { ConnectionBanner, ReplacedOverlay } from '../features/session/ConnectionBanner';
import { useGameSession } from '../features/session/useGameSession';
import { ApiError, claimSeat, fetchLobby } from '../lib/api';
import { formatCost } from '../lib/money';
import { markLaunched, readSeat, wasLaunched, writeSeat } from '../lib/storage';

export function LobbyPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [seat, setSeat] = useState(() => readSeat(code));
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const session = useGameSession(code, seat ? 'player' : 'off');
  const lobby = useQuery({
    queryKey: ['lobby', code],
    queryFn: () => fetchLobby(code),
    retry: false,
    refetchInterval: session.snapshot ? false : 2000,
  });

  const status = session.snapshot?.status ?? lobby.data?.status;
  const seats = session.snapshot?.seats ?? lobby.data?.seats ?? [];
  const rules = session.snapshot?.rules ?? lobby.data?.rules;
  const roundCount = rules?.roundCount ?? lobby.data?.roundCount ?? 20;

  const join = useMutation({
    mutationFn: (role: Role) => claimSeat(code, role),
    onSuccess: (result) => {
      writeSeat(code, { playerId: result.playerId, role: result.role, seatToken: result.seatToken });
      setSeat(readSeat(code));
      setError(null);
      if (result.game.status === 'playing') setLaunching(true);
    },
    onError: (cause: Error) => setError(cause instanceof ApiError ? cause.message : cause.message),
  });

  useEffect(() => {
    if (status !== 'playing' || !seat) return;
    if (wasLaunched(code)) {
      navigate(`/game/${code}`, { replace: true });
      return;
    }
    setLaunching(true);
    const timer = window.setTimeout(() => {
      markLaunched(code);
      navigate(`/game/${code}`);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [code, navigate, seat, status]);

  useEffect(() => {
    if (status === 'finished' && seat) navigate(`/game/${code}/results`, { replace: true });
  }, [code, navigate, seat, status]);

  return (
    <Shell>
      <ConnectionBanner link={session.link} onRetry={session.takeControl} />
      {session.replaced ? <ReplacedOverlay onTakeControl={session.takeControl} /> : null}
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.28em] text-muted">STATION ASSIGNMENT</p>
          <h1 className="mt-2 font-mono text-5xl tracking-[0.22em] sm:text-6xl">{code}</h1>
        </div>
        <button
          type="button"
          className="border border-line px-3 py-2 font-mono text-[11px] tracking-[0.16em] text-muted"
          onClick={() => void navigator.clipboard.writeText(window.location.href)}
        >
          COPY LINK
        </button>
      </div>
      {lobby.isError ? <p className="mt-6 text-alert">No simulation under that code.</p> : null}
      {error ? <p className="mt-4 text-sm text-alert">{error}</p> : null}
      {rules ? (
        <p className="mt-4 font-mono text-[11px] tracking-[0.14em] text-muted">
          {roundCount} ROUNDS · HOLD {formatCost(rules.holdingCostCents)} · BACKLOG {formatCost(rules.backlogCostCents)} · DELAY {rules.shippingDelay}
        </p>
      ) : null}

      <div className="mt-8 grid gap-3">
        {ROLES.map((role) => {
          const station = seats.find((candidate) => candidate.role === role);
          const mine = seat?.role === role;
          return (
            <div key={role} className={`flex items-center justify-between border px-4 py-4 ${mine ? 'border-cyan' : 'border-line'}`}>
              <div>
                <p className="font-mono text-xs tracking-[0.2em]">{ROLE_LABEL[role].toUpperCase()}</p>
                <p className="mt-1 text-sm text-muted">{station?.taken ? (mine ? 'Your station' : 'Manned') : 'Open'}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${station?.connected ? 'bg-lime' : 'bg-line'}`} />
                {mine ? (
                  <span className="font-mono text-[11px] tracking-[0.16em] text-cyan">SEATED</span>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(station?.taken) || join.isPending || status === 'playing' || status === 'finished'}
                    className="border border-cyan px-3 py-2 font-mono text-[11px] tracking-[0.16em] text-cyan disabled:border-line disabled:text-muted"
                    onClick={() => join.mutate(role)}
                  >
                    CLAIM
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {status === 'playing' && !seat ? (
        <HudFrame label="ALREADY UNDERWAY" className="mt-6">
          <p>All stations are manned. You can observe without placing orders.</p>
          <div className="mt-4">
            <AppLink to={`/game/${code}/watch`}>OPEN OBSERVER MODE</AppLink>
          </div>
        </HudFrame>
      ) : null}

      {launching ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-void/85">
          <div className="text-center">
            <p className="font-mono text-[11px] tracking-[0.28em] text-lime">ALL STATIONS MANNED</p>
            <h2 className="mt-3 text-4xl">Launching round 01</h2>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
