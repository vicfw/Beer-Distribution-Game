import { ROLE_LABEL, ROLES, type Debrief } from '@beer-game/shared';
import { useParams } from 'react-router';
import { AppLink } from '../components/AppLink';
import { ChainMap } from '../components/ChainMap';
import { HudFrame, Shell } from '../components/HudFrame';
import { ConnectionBanner } from '../features/session/ConnectionBanner';
import { useGameSession } from '../features/session/useGameSession';
import { formatCost } from '../lib/money';
import { ROLE_COLOR } from '../lib/palette';

export function WatchPage() {
  const { code = '' } = useParams();
  const session = useGameSession(code, 'spectator');
  const snapshot = session.snapshot?.kind === 'spectator' ? session.snapshot : null;

  return (
    <Shell>
      <ConnectionBanner link={session.link} onRetry={session.takeControl} />
      <div className="mt-8 flex items-end justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-[0.28em] text-amber">OBSERVER</p>
          <h1 className="mt-2 font-mono text-4xl tracking-[0.16em]">{code}</h1>
        </div>
        <AppLink to={`/game/${code}/results`}>DEBRIEF</AppLink>
      </div>
      <p className="mt-4 max-w-xl text-sm text-muted">
        You can see who is linked and who has locked an order. Station numbers stay sealed until the run ends.
      </p>
      {!snapshot ? <p className="mt-8 font-mono text-sm text-cyan">ACQUIRING PUBLIC CHANNEL</p> : null}
      {snapshot ? (
        <>
          <p className="mt-6 font-mono text-sm tabular text-muted">
            ROUND {String(snapshot.round).padStart(2, '0')} / {String(snapshot.roundCount).padStart(2, '0')}
          </p>
          <div className="mt-4">
            <ChainMap seats={snapshot.seats} redacted={snapshot.status !== 'finished'} />
          </div>
          {snapshot.debrief ? <CostSummary debrief={snapshot.debrief} /> : null}
        </>
      ) : null}
    </Shell>
  );
}

function CostSummary({ debrief }: { debrief: Debrief }) {
  return (
    <HudFrame label="UNSEALED COSTS" className="mt-6">
      <p className="font-mono text-4xl tabular text-cyan">{formatCost(debrief.totalCostCents)}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {ROLES.map((role) => (
          <p key={role} className="font-mono text-sm" style={{ color: ROLE_COLOR[role] }}>
            {ROLE_LABEL[role]} {formatCost(debrief.costs[role])}
          </p>
        ))}
      </div>
    </HudFrame>
  );
}
