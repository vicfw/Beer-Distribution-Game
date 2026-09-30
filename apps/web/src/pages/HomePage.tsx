import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { HudFrame, Shell } from '../components/HudFrame';
import { createGame, fetchHealth } from '../lib/api';
import { parseDemand } from '../lib/money';

export function HomePage() {
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: 0 });
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [holdingCost, setHoldingCost] = useState('0.5');
  const [backlogCost, setBacklogCost] = useState('1');
  const [shippingDelay, setShippingDelay] = useState('2');
  const [initialInventory, setInitialInventory] = useState('12');
  const [initialBacklog, setInitialBacklog] = useState('0');
  const [roundCount, setRoundCount] = useState('20');
  const [demand, setDemand] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: createGame,
    onSuccess: (result) => navigate(`/game/${result.code}/lobby`),
    onError: (error: Error) => setFormError(error.message),
  });

  return (
    <Shell>
      <h1 className="mt-12 max-w-3xl text-5xl font-medium tracking-tight sm:text-6xl">Beer Distribution Game</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted">
        Four stations. Orders move upstream, shipments move downstream, and nobody sees the other stations&apos; numbers until the run ends.
      </p>
      {health.isError ? (
        <p className="mt-4 font-mono text-xs tracking-[0.16em] text-alert">CONTROL LINK UNAVAILABLE</p>
      ) : (
        <p className="mt-4 font-mono text-xs tracking-[0.16em] text-lime">CHANNEL OPEN</p>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.35fr_0.8fr]">
        <HudFrame label="INITIALIZE SIMULATION">
          <p className="text-sm text-muted">Classic setup: 12 on hand, two shipments of 4 already moving, demand 4 then 8, twenty rounds.</p>
          <button
            type="button"
            className="mt-4 font-mono text-[11px] tracking-[0.18em] text-cyan"
            onClick={() => setRulesOpen((open) => !open)}
          >
            {rulesOpen ? 'HIDE STANDING ORDERS' : 'ADJUST STANDING ORDERS'}
          </button>
          {rulesOpen ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Holding cost" value={holdingCost} onChange={setHoldingCost} />
              <Field label="Backlog cost" value={backlogCost} onChange={setBacklogCost} />
              <Field label="Shipping delay" value={shippingDelay} onChange={setShippingDelay} />
              <Field label="Initial inventory" value={initialInventory} onChange={setInitialInventory} />
              <Field label="Initial backlog" value={initialBacklog} onChange={setInitialBacklog} />
              <Field label="Rounds" value={roundCount} onChange={setRoundCount} />
              <label className="sm:col-span-2 text-xs text-muted">
                Demand sequence
                <textarea
                  className="mt-1 w-full border border-line bg-void p-2 font-mono text-sm text-ink"
                  rows={3}
                  placeholder="Leave blank for 4,4,4,4 then 8"
                  value={demand}
                  onChange={(event) => setDemand(event.target.value)}
                />
              </label>
            </div>
          ) : null}
          {formError ? <p className="mt-3 text-sm text-alert">{formError}</p> : null}
          <button
            type="button"
            disabled={create.isPending}
            className="mt-6 bg-cyan px-5 py-3 font-mono text-xs tracking-[0.22em] text-void disabled:opacity-60"
            onClick={() => {
              setFormError(null);
              if (!rulesOpen) {
                create.mutate({});
                return;
              }
              const parsedDemand = demand.trim() ? parseDemand(demand) : null;
              if (demand.trim() && !parsedDemand) {
                setFormError('Demand must be a list of whole numbers.');
                return;
              }
              const holding = Number(holdingCost);
              const backlog = Number(backlogCost);
              const delay = Number(shippingDelay);
              const inventory = Number(initialInventory);
              const initial = Number(initialBacklog);
              const rounds = Number(roundCount);
              if ([holding, backlog, delay, inventory, initial, rounds].some((value) => Number.isNaN(value))) {
                setFormError('Standing orders must be numbers.');
                return;
              }
              create.mutate({
                holdingCost: holding,
                backlogCost: backlog,
                shippingDelay: delay,
                initialInventory: inventory,
                initialBacklog: initial,
                roundCount: parsedDemand?.length ?? rounds,
                ...(parsedDemand ? { demandSequence: parsedDemand } : {}),
              });
            }}
          >
            {create.isPending ? 'OPENING CHANNEL' : 'INITIALIZE SIMULATION'}
          </button>
        </HudFrame>

        <HudFrame label="JOIN BY CODE">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = code.trim().toUpperCase();
              if (!/^[A-Z2-9]{6}$/.test(next)) {
                setJoinError('Codes are 6 characters, without 0, 1, I, or O.');
                return;
              }
              navigate(`/game/${next}/lobby`);
            }}
          >
            <input
              aria-label="Game code"
              className="w-full border border-line bg-void px-3 py-4 text-center font-mono text-3xl tracking-[0.28em] uppercase"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            {joinError ? <p className="mt-3 text-sm text-alert">{joinError}</p> : null}
            <button type="submit" className="mt-4 w-full border border-cyan py-3 font-mono text-xs tracking-[0.22em] text-cyan">
              ENTER LOBBY
            </button>
          </form>
          <p className="mt-4 text-xs text-muted">Open four tabs to take all four stations. Each tab keeps its own seat.</p>
        </HudFrame>
      </div>
    </Shell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs text-muted">
      {label}
      <input className="mt-1 w-full border border-line bg-void px-2 py-2 font-mono text-sm text-ink" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
