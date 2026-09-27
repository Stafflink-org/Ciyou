import { useId, type ReactNode } from 'react';
import {
  Area,
  AreaChart as RechartsAreaChart,
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../lib/cn';
import { CHART_COLORS } from '../lib/chart-colors';
import { formatNumber } from '../lib/format';

export interface ChartSeries {
  /** Clé de la valeur dans chaque point de données. */
  key: string;
  label: string;
  color?: string;
}

type Datum = Record<string, string | number | null | undefined>;

interface CartesianProps {
  data: Datum[];
  /** Clé de l'axe horizontal (date, libellé…). */
  xKey: string;
  series: ChartSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  /** Formateur compact pour l'axe vertical. */
  axisFormatter?: (value: number) => string;
  hideYAxis?: boolean;
  className?: string;
}

const axisTick = { fill: 'var(--gl-chart-axis)', fontSize: 11, fontFamily: 'var(--font-mono)' };

function seriesColor(series: ChartSeries, index: number): string {
  return series.color ?? CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0];
}

interface TooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  value?: number | string;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: ReactNode;
  valueFormatter: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-border bg-elevated px-3 py-2.5 text-xs shadow-lg">
      {label !== undefined && <p className="mb-1.5 font-mono text-2xs uppercase tracking-wider text-fg-subtle">{label}</p>}
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-fg-muted">
              <span className="size-2 rounded-full" style={{ background: entry.color }} />
              {entry.name}
            </span>
            <span className="font-mono font-medium text-fg num">
              {typeof entry.value === 'number' ? valueFormatter(entry.value) : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Légende compacte, commune aux graphiques multi-séries. */
export function ChartLegend({ series, className }: { series: ChartSeries[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-fg-muted', className)}>
      {series.map((item, index) => (
        <span key={item.key} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: seriesColor(item, index) }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const defaultFormat = (value: number) => formatNumber(value);
const compactFormat = (value: number) => formatNumber(value, { compact: true });

/** Courbes pleines en dégradé (CA, commandes dans le temps). */
export function AreaChart({
  data,
  xKey,
  series,
  height = 280,
  valueFormatter = defaultFormat,
  axisFormatter = compactFormat,
  hideYAxis,
  className,
}: CartesianProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <defs>
            {series.map((item, index) => (
              <linearGradient key={item.key} id={`${uid}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(item, index)} stopOpacity={0.28} />
                <stop offset="100%" stopColor={seriesColor(item, index)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke="var(--gl-chart-grid)" strokeDasharray="3 4" />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={axisTick} tickMargin={10} minTickGap={24} />
          {!hideYAxis && (
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisFormatter} width={60} />
          )}
          <Tooltip
            cursor={{ stroke: 'var(--gl-border-strong)', strokeWidth: 1 }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as readonly TooltipEntry[] | undefined}
                label={props.label as ReactNode}
                valueFormatter={valueFormatter}
              />
            )}
          />
          {series.map((item, index) => (
            <Area
              key={item.key}
              type="monotone"
              dataKey={item.key}
              name={item.label}
              stroke={seriesColor(item, index)}
              strokeWidth={2}
              fill={`url(#${uid}-${item.key})`}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--gl-surface)' }}
              dot={false}
            />
          ))}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarChartProps extends CartesianProps {
  stacked?: boolean;
  /** Barres horizontales (classements : top restaurants, villes…). */
  horizontal?: boolean;
}

/** Histogramme groupé ou empilé. */
export function BarChart({
  data,
  xKey,
  series,
  height = 280,
  valueFormatter = defaultFormat,
  axisFormatter = compactFormat,
  hideYAxis,
  stacked,
  horizontal,
  className,
}: BarChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: horizontal ? 20 : 8, bottom: 0, left: 4 }}
          barGap={4}
          barCategoryGap={horizontal ? '28%' : '24%'}
        >
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--gl-chart-grid)" strokeDasharray="3 4" />
          {horizontal ? (
            <>
              <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisFormatter} />
              <YAxis
                type="category"
                dataKey={xKey}
                tickLine={false}
                axisLine={false}
                width={110}
                tick={{ ...axisTick, fontFamily: 'var(--font-sans)', fontSize: 12, fill: 'var(--gl-fg-muted)' }}
              />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={axisTick} tickMargin={10} minTickGap={12} />
              {!hideYAxis && <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={axisFormatter} width={60} />}
            </>
          )}
          <Tooltip
            cursor={{ fill: 'var(--gl-surface-3)', opacity: 0.6 }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                payload={props.payload as readonly TooltipEntry[] | undefined}
                label={props.label as ReactNode}
                valueFormatter={valueFormatter}
              />
            )}
          />
          {series.map((item, index) => {
            const last = index === series.length - 1;
            const radius: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
            return (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                fill={seriesColor(item, index)}
                stackId={stacked ? 'stack' : undefined}
                radius={!stacked || last ? radius : 0}
                maxBarSize={horizontal ? 18 : 36}
              />
            );
          })}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: DonutDatum[];
  height?: number;
  /** Valeur mise en avant au centre (total…). */
  centerValue?: ReactNode;
  centerLabel?: ReactNode;
  valueFormatter?: (value: number) => string;
  /** Légende avec valeurs et parts à droite (ou dessous sur mobile). */
  showLegend?: boolean;
  className?: string;
}

/** Répartition en anneau (canaux de paiement, formules, villes…). */
export function DonutChart({
  data,
  height = 200,
  centerValue,
  centerLabel,
  valueFormatter = defaultFormat,
  showLegend = true,
  className,
}: DonutChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colored = data.map((item, index) => ({
    ...item,
    color: item.color ?? CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0],
  }));
  return (
    <div className={cn('@container', className)}>
      <div className="flex flex-col items-center gap-6 @sm:flex-row">
        <div className="relative shrink-0" style={{ width: height, maxWidth: '100%', aspectRatio: '1 / 1' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={colored}
                dataKey="value"
                nameKey="label"
                innerRadius="70%"
                outerRadius="100%"
                paddingAngle={2}
                cornerRadius={4}
                stroke="none"
                isAnimationActive
              >
                {colored.map((item) => (
                  <Cell key={item.label} fill={item.color} />
                ))}
              </Pie>
              <Tooltip
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={(props.payload as readonly TooltipEntry[] | undefined)?.map((entry) => ({
                      ...entry,
                      color: (entry as TooltipEntry & { payload?: { color?: string } }).payload?.color,
                    }))}
                    valueFormatter={valueFormatter}
                  />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
          {(centerValue !== undefined || centerLabel) && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              {centerValue !== undefined && (
                <span className="font-display text-2xl font-semibold tracking-display text-fg num">{centerValue}</span>
              )}
              {centerLabel && <span className="text-xs text-fg-subtle">{centerLabel}</span>}
            </div>
          )}
        </div>
        {showLegend && (
          <ul className="w-full min-w-0 flex-1 space-y-2.5">
            {colored.map((item) => (
              <li key={item.label} className="flex items-center gap-2.5 text-sm">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: item.color }} />
                <span className="min-w-0 flex-1 truncate text-fg-muted">{item.label}</span>
                <span className="font-mono text-xs text-fg num">{valueFormatter(item.value)}</span>
                <span className="w-12 text-end font-mono text-xs text-fg-subtle num">
                  {total > 0 ? `${Math.round((item.value / total) * 100)} %` : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export interface SparklineProps {
  data: number[];
  color?: string;
  /** « area » : courbe avec remplissage ; « line » : trait seul. */
  variant?: 'area' | 'line';
  className?: string;
}

/** Mini-tendance sans axes, pour les cartes KPI. */
export function Sparkline({ data, color = 'var(--tone-solid, var(--gl-chart-1))', variant = 'area', className }: SparklineProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const points = data.map((value, index) => ({ index, value }));
  return (
    <div className={cn('size-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        {variant === 'line' ? (
          <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
          </LineChart>
        ) : (
          <RechartsAreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`${uid}-spark`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={1.75}
              fill={`url(#${uid}-spark)`}
              dot={false}
              isAnimationActive={false}
            />
          </RechartsAreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
