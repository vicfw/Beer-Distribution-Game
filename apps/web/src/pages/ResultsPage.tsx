import { ROLE_LABEL, ROLES, type Debrief } from '@beer-game/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { AppLink } from '../components/AppLink';
import { HistoryTable, RoundInspector } from '../components/HistoryTable';
import { HudFrame, Shell } from '../components/HudFrame';
import { LineChart } from '../components/LineChart';
import { ApiError, fetchHistory } from '../lib/api';
import { formatCost } from '../lib/money';
import { ROLE_COLOR } from '../lib/palette';

export function ResultsPage() {
  const { code = '' } = useParams();
  const [picked, setPicked] = useState<number | null>(null);
  const [view, setView] = useState<'inventory' | 'backlog' | 'cost'>('inventory');
  const history = useQuery({
    queryKey: ['history', code],
    queryFn: () => fetchHistory(code),
    retry: (count, error) => !(error instanceof ApiError && error.status === 409) && count < 1,
  });

  return (
    <Shell>
      <div className="mt-8 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] tracking-[0.28em] text-muted">MISSION DEBRIEF · {code}</p>
          <h1 className="mt-2 text-4xl">What the chain amplified</h1>
        </div>
        <AppLink to={`/game/${code}`}>BACK TO CONSOLE</AppLink>
      </div>

      {history.isLoading ? <p className="mt-8 font-mono text-sm text-cyan">UNSEALING LOG</p> : null}
      {history.error instanceof ApiError && history.error.status === 409 ? (
        <HudFrame label="SEALED" className="mt-8">
          <p>Costs and other stations stay hidden until the game ends.</p>
        </HudFrame>
      ) : null}
      {history.error && !(history.error instanceof ApiError && history.error.status === 409) ? (
        <p className="mt-8 text-alert">{history.error.message}</p>
      ) : null}
      {history.data ? (
        <DebriefBody
          debrief={history.data}
          selected={picked ?? history.data.rounds.at(-1)?.round ?? null}
          onSelect={setPicked}
          view={view}
          onView={setView}
        />
      ) : null}
    </Shell>
  );
}

function DebriefBody({
  debrief,
  selected,
  onSelect,
  view,
  onView,
}: {
  debrief: Debrief;
  selected: number | null;
  onSelect: (round: number) => void;
  view: 'inventory' | 'backlog' | 'cost';
  onView: (view: 'inventory' | 'backlog' | 'cost') => void;
}) {
  const orders = [
    { id: 'demand', label: 'Customer demand', color: '#8ea4b8', values: debrief.rounds.map((round) => round.customerDemand) },
    ...ROLES.map((role) => ({
      id: role,
      label: `${ROLE_LABEL[role]} orders`,
      color: ROLE_COLOR[role],
      values: debrief.rounds.map((round) => round.roles[role].orderPlaced),
    })),
  ];
  const stocks = ROLES.map((role) => ({
    id: role,
    label: ROLE_LABEL[role],
    color: ROLE_COLOR[role],
    values: debrief.rounds.map((round) =>
      view === 'inventory' ? round.roles[role].inventory : view === 'backlog' ? round.roles[role].backlog : round.roles[role].totalCostCents / 100,
    ),
  }));

  return (
    <div className="mt-8 space-y-8">
      <div>
        <p className="font-mono text-[11px] tracking-[0.2em] text-muted">TOTAL COST</p>
        <p className="font-mono text-6xl tabular text-cyan">{formatCost(debrief.totalCostCents)}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {ROLES.map((role) => (
            <article key={role} className="border border-line px-3 py-3">
              <p className="font-mono text-[10px] tracking-[0.16em]" style={{ color: ROLE_COLOR[role] }}>
                {ROLE_LABEL[role].toUpperCase()}
              </p>
              <p className="mt-2 font-mono text-2xl tabular">{formatCost(debrief.costs[role])}</p>
            </article>
          ))}
        </div>
      </div>

      <HudFrame label="BULLWHIP — ORDERS VERSUS DEMAND">
        <p className="mb-4 max-w-2xl text-sm text-muted">
          If the order lines swing wider than customer demand as you move upstream, the chain is amplifying a small change. That is the bullwhip.
        </p>
        <LineChart series={orders} ariaLabel="Customer demand and orders placed by each role" />
      </HudFrame>

      <HudFrame label="INVENTORY, BACKLOG, COST">
        <div className="mb-4 flex gap-2">
          {(['inventory', 'backlog', 'cost'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className={`border px-3 py-1 font-mono text-[11px] tracking-[0.14em] ${view === option ? 'border-cyan text-cyan' : 'border-line text-muted'}`}
              onClick={() => onView(option)}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
        <LineChart series={stocks} ariaLabel={`${view} by role`} format={(value) => (view === 'cost' ? value.toFixed(1) : String(value))} />
      </HudFrame>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <HistoryTable rounds={debrief.rounds} selected={selected} onSelect={onSelect} />
        <RoundInspector debrief={debrief} round={selected} />
      </div>
    </div>
  );
}
