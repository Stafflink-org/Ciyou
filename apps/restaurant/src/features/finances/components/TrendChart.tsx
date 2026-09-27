import { useEffect, useId, useRef, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';

export interface TrendPoint {
  label: string;
  fullLabel: string;
  previousLabel?: string;
  current: number;
  previous: number | null;
}

const axisTick = { fill: 'var(--gl-chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' };

/** Courbe de la période (aire en dégradé) et de la période précédente (trait pointillé). */
export function TrendChart({
  data,
  format,
  axisFormat,
  height = 300,
  showPrevious = true,
}: {
  data: TrendPoint[];
  format: (value: number) => string;
  axisFormat: (value: number) => string;
  height?: number;
  showPrevious?: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  // ResponsiveContainer ne recalcule pas toujours sa largeur lors d'un redimensionnement live
  // de la fenêtre à l'intérieur d'une grille CSS (le conteneur peut ne pas rétrécir tant qu'il
  // n'est pas rechargé). On mesure donc explicitement le conteneur via ResizeObserver.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const measure = () => setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    // Filet de sécurité : certains environnements (redimensionnement programmatique,
    // outils d'automatisation) ne déclenchent pas toujours ResizeObserver.
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full min-w-0" style={{ height }}>
      {width > 0 && (
        <ComposedChart width={width} height={height} data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gl-chart-1)" stopOpacity={0.26} />
              <stop offset="100%" stopColor="var(--gl-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--gl-chart-grid)" strokeDasharray="3 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} tickMargin={10} minTickGap={22} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisFormat} width={62} domain={[0, 'auto']} />
          <Tooltip
            cursor={{ stroke: 'var(--gl-border-strong)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as TrendPoint | undefined;
              if (!active || !point) return null;
              return (
                <div className="min-w-52 rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs shadow-lg">
                  <p className="mb-2 font-medium text-fg first-letter:uppercase">{point.fullLabel}</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-1.5 text-fg-muted">
                        <span className="size-2 rounded-full bg-chart-1" />
                        Période
                      </span>
                      <span className="font-mono font-medium text-fg num">{format(point.current)}</span>
                    </div>
                    {showPrevious && point.previous !== null && (
                      <div className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-fg-muted">
                          <span className="h-0.5 w-2.5 rounded-full bg-fg-subtle" />
                          {point.previousLabel ? <span className="first-letter:uppercase">{point.previousLabel}</span> : 'Précédente'}
                        </span>
                        <span className="font-mono text-fg-muted num">{format(point.previous)}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            }}
          />
          {showPrevious && (
            <Line
              type="monotone"
              dataKey="previous"
              stroke="var(--gl-chart-axis)"
              strokeOpacity={0.7}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          <Area
            type="monotone"
            dataKey="current"
            stroke="var(--gl-chart-1)"
            strokeWidth={2.25}
            fill={`url(#${uid}-fill)`}
            dot={false}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--gl-surface)', fill: 'var(--gl-chart-1)' }}
            isAnimationActive={false}
          />
        </ComposedChart>
      )}
    </div>
  );
}
