import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatTemp } from './data';

interface Point {
  date: string;
  valeur: number;
}

const axisTick = { fill: 'var(--gl-chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' };

/**
 * Courbe des relevés d'une enceinte : la plage de conformité est matérialisée
 * par une bande verte, les seuils par des lignes pointillées, les relevés hors
 * plage par un point rouge.
 */
export function TemperatureChart({ data, min, max, height = 220 }: { data: Point[]; min: number | null; max: number | null; height?: number }) {
  const values = data.map((p) => p.valeur);
  const bounds = [...values, ...(min !== null ? [min] : []), ...(max !== null ? [max] : [])];
  const low = Math.floor(Math.min(...bounds) - 2);
  const high = Math.ceil(Math.max(...bounds) + 2);
  const outOfRange = (v: number) => (min !== null && v < min) || (max !== null && v > max);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--gl-chart-grid)" strokeDasharray="3 4" />
          {(min !== null || max !== null) && (
            <ReferenceArea y1={min ?? low} y2={max ?? high} fill="var(--color-success)" fillOpacity={0.08} stroke="none" ifOverflow="extendDomain" />
          )}
          {min !== null && <ReferenceLine y={min} stroke="var(--color-danger)" strokeDasharray="4 4" strokeOpacity={0.7} />}
          {max !== null && <ReferenceLine y={max} stroke="var(--color-danger)" strokeDasharray="4 4" strokeOpacity={0.7} />}
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={axisTick} tickMargin={10} minTickGap={32} />
          <YAxis domain={[low, high]} tickLine={false} axisLine={false} tick={axisTick} tickFormatter={(v: number) => `${v} °`} width={48} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: 'var(--gl-border-strong)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              const value = payload?.[0]?.value;
              if (!active || typeof value !== 'number') return null;
              return (
                <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
                  <p className="text-fg-subtle">{label}</p>
                  <p className={outOfRange(value) ? 'font-semibold text-danger num' : 'font-semibold text-fg num'}>{formatTemp(value)}</p>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="valeur"
            stroke="var(--gl-chart-1)"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; value?: number; index?: number }) => {
              const { cx, cy, value, index } = props;
              if (cx === undefined || cy === undefined || typeof value !== 'number' || !outOfRange(value)) return <g key={`d${index}`} />;
              return <circle key={`d${index}`} cx={cx} cy={cy} r={4} fill="var(--color-danger)" stroke="var(--gl-surface)" strokeWidth={2} />;
            }}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--gl-surface)' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
