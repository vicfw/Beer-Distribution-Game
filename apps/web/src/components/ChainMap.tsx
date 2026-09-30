import { ROLE_LABEL, type Role, type SeatPublic } from '@beer-game/shared';
import { ROLE_COLOR } from '../lib/palette';

type NodeId = 'customer' | Role | 'supplier';

const NODES: NodeId[] = ['customer', 'retailer', 'wholesaler', 'distributor', 'factory', 'supplier'];

export function ChainMap({
  you,
  seats,
  inventory,
  shipment,
  redacted,
}: {
  you?: Role;
  seats: SeatPublic[];
  inventory?: number;
  shipment?: number;
  redacted: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[720px] items-stretch gap-2">
        {NODES.map((node, index) => {
          const seat = seats.find((candidate) => candidate.role === node);
          const active = you === node;
          const hideNumbers = redacted && node !== you;
          return (
            <div key={node} className="flex flex-1 items-center gap-2">
              <article
                className={`min-h-36 flex-1 border px-3 py-3 ${active ? 'border-cyan bg-cyan/10' : 'border-line bg-panel-2'}`}
              >
                <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em] text-muted">
                  <span style={{ color: isRoleNode(node) ? ROLE_COLOR[node] : undefined }}>{label(node)}</span>
                  {seat ? <Lamp on={seat.connected} /> : null}
                </div>
                {node === 'customer' || node === 'supplier' ? (
                  <p className="mt-6 font-mono text-[10px] tracking-[0.16em] text-muted">
                    {node === 'customer' ? 'DEMAND SINK' : 'UNLIMITED'}
                  </p>
                ) : hideNumbers ? (
                  <div className="mt-5">
                    <div className="classified" aria-hidden />
                    <p className="mt-3 font-mono text-[10px] tracking-[0.18em] text-muted">CLASSIFIED</p>
                  </div>
                ) : (
                  <p className="mt-4 font-mono text-3xl tabular text-ink">{active ? (inventory ?? 0) : '—'}</p>
                )}
                {seat ? (
                  <p className={`mt-3 font-mono text-[10px] tracking-[0.16em] ${seat.submitted ? 'text-lime' : 'text-amber'}`}>
                    {seat.submitted ? 'ORDER LOCKED' : seat.taken ? 'AWAITING' : 'OPEN'}
                  </p>
                ) : null}
                {active && !hideNumbers && shipment !== undefined ? (
                  <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-cyan">INBOUND {shipment}</p>
                ) : null}
              </article>
              {index < NODES.length - 1 ? <Rail active={active || NODES[index + 1] === you} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Rail({ active }: { active: boolean }) {
  return (
    <div className="relative h-px w-6 bg-line">
      <span className={`absolute -top-1 left-1 h-2 w-2 rounded-full ${active ? 'bg-cyan' : 'bg-line'}`} />
    </div>
  );
}

function Lamp({ on }: { on: boolean }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-lime' : 'bg-line'}`} aria-label={on ? 'linked' : 'dark'} />;
}

function label(node: NodeId): string {
  if (node === 'customer') return 'CUSTOMER';
  if (node === 'supplier') return 'SUPPLIER';
  return ROLE_LABEL[node].toUpperCase();
}

function isRoleNode(node: NodeId): node is Role {
  return node !== 'customer' && node !== 'supplier';
}
