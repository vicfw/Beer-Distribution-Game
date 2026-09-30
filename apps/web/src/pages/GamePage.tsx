import { ROLE_LABEL } from '@beer-game/shared';
import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { AppLink } from '../components/AppLink';
import { ChainMap } from '../components/ChainMap';
import { Shell } from '../components/HudFrame';
import { OrderConsole } from '../components/OrderConsole';
import { ConnectionBanner, ReplacedOverlay } from '../features/session/ConnectionBanner';
import { useGameSession } from '../features/session/useGameSession';
import { formatCost } from '../lib/money';
import { readSeat } from '../lib/storage';

export function GamePage() {
  const { code = '' } = useParams();
  const seat = readSeat(code);
  const session = useGameSession(code, seat ? 'player' : 'off');
  const station = session.player?.station ?? null;
  const [quantity, setQuantity] = useState(4);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!station || station.submitted) return;
    setQuantity(station.lastOrder);
  }, [session.player?.round, station?.submitted, station?.lastOrder]);

  if (!seat) return <Navigate to={`/game/${code}/lobby`} replace />;
  if (session.player?.status === 'lobby') return <Navigate to={`/game/${code}/lobby`} replace />;

  const waiting = session.player?.seats.filter((item) => item.taken && !item.submitted).length ?? 0;
  const round = session.player?.round ?? 0;
  const roundCount = session.player?.roundCount ?? 20;

  return (
    <Shell>
      <ConnectionBanner link={session.link} onRetry={session.takeControl} />
      {session.replaced ? <ReplacedOverlay onTakeControl={session.takeControl} /> : null}
      <div className={`mt-6 ${session.link === 'live' ? '' : 'opacity-90'}`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] tracking-[0.24em] text-muted">
              {station ? ROLE_LABEL[station.role].toUpperCase() : seat.role.toUpperCase()}
            </p>
            <h1 className="mt-1 font-mono text-4xl tabular">
              {String(round).padStart(2, '0')}
              <span className="text-muted"> / {String(roundCount).padStart(2, '0')}</span>
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-[11px] tracking-[0.18em] text-lime">{session.link === 'live' ? 'LINK LIVE' : session.link.toUpperCase()}</span>
            {session.player?.status === 'finished' ? <AppLink to={`/game/${code}/results`}>OPEN DEBRIEF</AppLink> : null}
          </div>
        </div>
        <div className="mt-4 flex gap-1">
          {Array.from({ length: roundCount }, (_, index) => (
            <span key={index} className={`h-1.5 flex-1 ${index < round ? 'bg-cyan' : 'bg-line'}`} />
          ))}
        </div>

        {!session.player ? (
          <div className="mt-10 border border-line p-8">
            <p className="font-mono text-sm tracking-[0.2em] text-cyan">ACQUIRING TELEMETRY</p>
            <p className="mt-2 text-muted">The last known board stays here once the link has delivered a snapshot.</p>
          </div>
        ) : (
          <>
            <div className="mt-6">
              <ChainMap
                you={session.player.you.role}
                seats={session.player.seats}
                inventory={station?.inventory}
                shipment={station?.shipmentArrived}
                redacted={session.player.status !== 'finished'}
              />
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Tile label="INVENTORY" value={station?.inventory ?? 0} />
                <Tile label="BACKLOG" value={station?.backlog ?? 0} alert={(station?.backlog ?? 0) > 0} />
                <Tile label="INBOUND SHIPMENT" value={station?.shipmentArrived ?? 0} />
                <Tile label="INCOMING ORDER" value={station?.incomingOrder ?? 0} />
                <Tile label="LAST ORDER" value={station?.lastOrder ?? 0} />
                <Tile label="COST SO FAR" value={formatCost(station?.totalCostCents ?? 0)} />
              </div>
              <div>
                <OrderConsole
                  quantity={station?.submitted ? (station.submittedQuantity ?? quantity) : quantity}
                  disabled={!station || station.submitted || session.sending || session.player.status !== 'playing'}
                  submitted={Boolean(station?.submitted)}
                  waiting={waiting}
                  finalRound={round === roundCount}
                  sending={session.sending}
                  onChange={setQuantity}
                  onSubmit={() => {
                    setError(null);
                    void session.submit(quantity).catch((cause: Error) => setError(cause.message));
                  }}
                />
                {error || session.notice ? <p className="mt-3 text-sm text-amber">{error ?? session.notice}</p> : null}
              </div>
            </div>
            {session.player.history.length > 0 ? (
              <div className="mt-6">
                <p className="font-mono text-[11px] tracking-[0.2em] text-muted">YOUR TRACE</p>
                <Sparkline values={session.player.history.map((round) => round.inventory)} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </Shell>
  );
}

function Tile({ label, value, alert = false }: { label: string; value: number | string; alert?: boolean }) {
  return (
    <div className="border border-line bg-panel px-3 py-3">
      <p className="font-mono text-[10px] tracking-[0.16em] text-muted">{label}</p>
      <p className={`mt-2 font-mono text-3xl tabular ${alert ? 'text-alert' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const width = 320;
  const height = 64;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${index * step},${height - (value / max) * height}`).join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-16 w-full" role="img" aria-label="Your inventory over completed rounds">
      <polyline fill="none" stroke="#3ee0ff" strokeWidth="2" points={points} />
    </svg>
  );
}
