import { ROLE_LABEL, ROLES, type Debrief, type PublicRound } from '@beer-game/shared';
import { formatCost } from '../lib/money';

export function HistoryTable({
  rounds,
  selected,
  onSelect,
}: {
  rounds: PublicRound[];
  selected: number | null;
  onSelect: (round: number) => void;
}) {
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[720px] text-left font-mono text-xs">
        <thead className="text-muted">
          <tr>
            <th className="px-3 py-2">Round</th>
            <th className="px-3 py-2">Demand</th>
            {ROLES.map((role) => (
              <th key={role} className="px-3 py-2">
                {ROLE_LABEL[role]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rounds.map((round) => (
            <tr
              key={round.round}
              className={`cursor-pointer border-t border-line ${selected === round.round ? 'bg-cyan/10' : ''}`}
              onClick={() => onSelect(round.round)}
            >
              <td className="px-3 py-2">{String(round.round).padStart(2, '0')}</td>
              <td className="px-3 py-2">{round.customerDemand}</td>
              {ROLES.map((role) => (
                <td key={role} className="px-3 py-2">
                  {round.roles[role].orderPlaced}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoundInspector({ debrief, round }: { debrief: Debrief; round: number | null }) {
  const record = debrief.rounds.find((item) => item.round === round);
  if (!record) return <p className="text-sm text-muted">Select a round to inspect inventory, backlog, and cost.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ROLES.map((role) => {
        const facts = record.roles[role];
        return (
          <article key={role} className="border border-line p-3">
            <p className="font-mono text-[11px] tracking-[0.18em] text-muted">{ROLE_LABEL[role].toUpperCase()}</p>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted">Inventory</dt>
              <dd className="text-right tabular">{facts.inventory}</dd>
              <dt className="text-muted">Backlog</dt>
              <dd className="text-right tabular">{facts.backlog}</dd>
              <dt className="text-muted">Order</dt>
              <dd className="text-right tabular">{facts.orderPlaced}</dd>
              <dt className="text-muted">Shipped</dt>
              <dd className="text-right tabular">{facts.shipped}</dd>
              <dt className="text-muted">Round cost</dt>
              <dd className="text-right tabular">{formatCost(facts.roundCostCents)}</dd>
              <dt className="text-muted">Total</dt>
              <dd className="text-right tabular">{formatCost(facts.totalCostCents)}</dd>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
