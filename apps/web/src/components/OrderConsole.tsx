export function OrderConsole({
  quantity,
  disabled,
  submitted,
  waiting,
  finalRound,
  sending,
  onChange,
  onSubmit,
}: {
  quantity: number;
  disabled: boolean;
  submitted: boolean;
  waiting: number;
  finalRound: boolean;
  sending: boolean;
  onChange: (quantity: number) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="border border-line bg-panel-2 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <p className="font-mono text-[11px] tracking-[0.24em] text-muted">ORDER QUANTITY</p>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="h-12 w-12 border border-line text-xl" disabled={disabled} onClick={() => onChange(Math.max(0, quantity - 1))}>
          −
        </button>
        <input
          aria-label="Order quantity"
          className="h-12 w-full border border-line bg-void text-center font-mono text-3xl tabular outline-none"
          inputMode="numeric"
          disabled={disabled}
          value={quantity}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isInteger(next) && next >= 0 && next <= 10_000) onChange(next);
            if (event.target.value === '') onChange(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onChange(Math.min(10_000, quantity + 1));
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              onChange(Math.max(0, quantity - 1));
            }
          }}
        />
        <button type="button" className="h-12 w-12 border border-line text-xl" disabled={disabled} onClick={() => onChange(Math.min(10_000, quantity + 1))}>
          +
        </button>
      </div>
      <button
        type="submit"
        disabled={disabled}
        className="mt-4 w-full bg-cyan py-3 font-mono text-xs tracking-[0.22em] text-void disabled:bg-line disabled:text-muted"
      >
        {sending ? 'TRANSMITTING' : submitted ? 'ORDER LOCKED' : 'TRANSMIT ORDER'}
      </button>
      {submitted ? (
        <p className="mt-3 text-center font-mono text-[11px] tracking-[0.16em] text-lime">
          {waiting === 0 ? 'ALL STATIONS LOCKED' : `AWAITING ${waiting} STATION${waiting === 1 ? '' : 'S'}`}
        </p>
      ) : null}
      {finalRound && !submitted ? (
        <p className="mt-3 text-xs text-amber">This order is recorded, then the simulation ends. It will not arrive.</p>
      ) : null}
    </form>
  );
}
