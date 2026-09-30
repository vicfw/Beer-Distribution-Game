import { ROLE_LABEL, ROLES, type GameStatus, type Role } from '@beer-game/shared';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AppLink } from '../components/AppLink';
import { HudFrame, Shell } from '../components/HudFrame';
import { ConnectionBanner, ReplacedOverlay } from '../features/session/ConnectionBanner';
import { useGameSession } from '../features/session/useGameSession';
import { claimSeat } from '../lib/api';
import { formatCost } from '../lib/money';
import { markLaunched, readSeat, wasLaunched, writeSeat } from '../lib/storage';

export function LobbyPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [seatCode, setSeatCode] = useState(code);
  const [seat, setSeat] = useState(() => readSeat(code));
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [joinedStatus, setJoinedStatus] = useState<GameStatus | null>(null);
  const holdingSeat = useRef(Boolean(readSeat(code)));
  if (seatCode !== code) {
    const nextSeat = readSeat(code);
    setSeatCode(code);
    setSeat(nextSeat);
    setJoinedStatus(null);
    setError(null);
    setLaunching(false);
    holdingSeat.current = Boolean(nextSeat);
  }
  const session = useGameSession(code, seat ? 'player' : 'lobby');
  const board = session.snapshot ?? session.presence;
  const status = board?.status ?? joinedStatus;
  const seats = board?.seats ?? [];
  const rules = board?.rules;

  const join = useMutation({
    mutationFn: (role: Role) => claimSeat(code, role),
    onSuccess: (result) => {
      writeSeat(code, {
        playerId: result.playerId,
        role: result.role,
        seatToken: result.seatToken,
      });
      setSeat(readSeat(code));
      setJoinedStatus(result.game.status);
      setError(null);
    },
    onError: (cause: Error) => {
      holdingSeat.current = false;
      setError(cause.message);
    },
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
      {session.missing ? <p className="mt-6 text-alert">No simulation under that code.</p> : null}
      {error ? <p className="mt-4 text-sm text-alert">{error}</p> : null}
      {rules ? (
        <p className="mt-4 font-mono text-[11px] tracking-[0.14em] text-muted">
          {rules.roundCount} ROUNDS · HOLD {formatCost(rules.holdingCostCents)} · BACKLOG{' '}
          {formatCost(rules.backlogCostCents)} · DELAY {rules.shippingDelay}
        </p>
      ) : null}

      <div className="mt-8 grid gap-3">
        {ROLES.map((role) => {
          const station = seats.find((candidate) => candidate.role === role);
          const mine = seat?.role === role;
          const heldHere = Boolean(seat);
          const claimable =
            board !== null &&
            !session.missing &&
            !heldHere &&
            !station?.taken &&
            !join.isPending &&
            status !== 'playing' &&
            status !== 'finished';
          return (
            <div
              key={role}
              className={`flex items-center justify-between border px-4 py-4 ${mine ? 'border-cyan' : 'border-line'}`}
            >
              <div>
                <p className="font-mono text-xs tracking-[0.2em]">
                  {ROLE_LABEL[role].toUpperCase()}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {stationStatus(mine, Boolean(station?.taken), heldHere, board !== null)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`h-2 w-2 rounded-full ${station?.connected ? 'bg-lime' : 'bg-line'}`}
                />
                {mine ? (
                  <span className="font-mono text-[11px] tracking-[0.16em] text-cyan">SEATED</span>
                ) : claimable ? (
                  <button
                    type="button"
                    className="border border-cyan px-3 py-2 font-mono text-[11px] tracking-[0.16em] text-cyan"
                    onClick={() => {
                      if (holdingSeat.current) return;
                      holdingSeat.current = true;
                      join.mutate(role);
                    }}
                  >
                    CLAIM
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {seat && status !== 'playing' && status !== 'finished' ? (
        <p className="mt-4 text-sm text-muted">
          This tab holds {ROLE_LABEL[seat.role]}. Claim each remaining station from its own tab.
        </p>
      ) : null}

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

function stationStatus(mine: boolean, taken: boolean, heldHere: boolean, known: boolean): string {
  if (!known) return 'Checking';
  if (mine) return 'Your station';
  if (taken) return 'Manned';
  if (heldHere) return 'Claim from another tab';
  return 'Open';
}
