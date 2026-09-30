import { useState } from 'react';

export type ChartSeries = {
  id: string;
  label: string;
  color: string;
  values: number[];
};

export function LineChart({
  series,
  ariaLabel,
  format = (value) => String(value),
}: {
  series: ChartSeries[];
  ariaLabel: string;
  format?: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 760;
  const height = 280;
  const pad = 36;
  const flat = series.flatMap((item) => item.values);
  const max = Math.max(1, ...flat);
  const count = Math.max(1, ...series.map((item) => item.values.length));
  const xAt = (index: number) => pad + (index * (width - pad * 2)) / Math.max(1, count - 1);
  const yAt = (value: number) => height - pad - (value / max) * (height - pad * 2);

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-72 w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - bounds.left) / bounds.width;
          const index = Math.round(ratio * Math.max(0, count - 1));
          setHover(Math.max(0, Math.min(count - 1, index)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((tick) => (
          <line key={tick} x1={pad} x2={width - pad} y1={yAt(max * tick)} y2={yAt(max * tick)} stroke="#1e3142" />
        ))}
        {series.map((item) => (
          <polyline
            key={item.id}
            fill="none"
            stroke={item.color}
            strokeWidth={item.id === 'demand' ? 2.5 : 1.75}
            points={item.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ')}
          />
        ))}
        {hover !== null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={pad} y2={height - pad} stroke="#7f93a6" /> : null}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] tracking-[0.12em]">
        {series.map((item) => {
          const value = hover === null ? undefined : item.values[hover];
          return (
            <span key={item.id} style={{ color: item.color }}>
              {item.label}
              {value !== undefined ? ` ${format(value)}` : ''}
            </span>
          );
        })}
        {hover !== null ? <span className="text-muted">ROUND {hover + 1}</span> : null}
      </div>
    </div>
  );
}
