/**
 * Dashboard charts.
 *
 * COLOUR — three categorical slots, validated (not eyeballed) in both modes with
 * the all-pairs pairlist, because pie slices and grouped bars put every pair on
 * screen together:
 *
 *   light  blue #2a78d6  orange #eb6834  aqua #1baf7a
 *   dark   blue #3987e5  orange #d95926  aqua #199e70
 *
 *   CVD separation  ΔE 9.2 light / 9.4 dark   (≥8 target)
 *   Normal vision   ΔE 24.0 light / 20.9 dark (≥15 floor)
 *   Contrast        aqua is 2.82:1 on the light surface → below 3:1, so the
 *                   RELIEF RULE applies and every chart here carries visible
 *                   value labels. Identity is never colour alone.
 *
 * Three slots, not eight: past three the all-pairs floors cannot be cleared, so
 * anything with more categories folds the tail into "Other" rather than
 * inventing a fourth hue.
 *
 * Colours come from CSS custom properties so light and dark swap in one place
 * rather than being branched in JavaScript.
 */

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, PieChart, Pie, ReferenceLine, LabelList,
  LineChart, Line,
} from 'recharts';

const GRID = 'var(--viz-grid)';
const AXIS = 'var(--viz-axis)';
const SURFACE = 'var(--viz-surface)';
const S1 = 'var(--viz-1)';
const S2 = 'var(--viz-2)';
const S3 = 'var(--viz-3)';

/** Shared tooltip. Values in ink, a colour chip beside them for identity. */
function VizTooltip({ active, payload, label, suffix = '' }: {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string }[];
  label?: string;
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 10px', fontSize: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,.12)',
    }}>
      {label && <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>}
      {payload.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.7 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, flexShrink: 0 }} />
          <span style={{ color: 'var(--text2)' }}>{p.name}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
            {p.value === null || p.value === undefined ? '—' : `${p.value}${suffix}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--text3)', fontSize: 12 }}>
      {text}
    </div>
  );
}

// ── Attendance and pass rate, by department ─────────────────────────────────

export interface DeptRow {
  dept_name: string;
  attendance_rate: number | null;
  pass_rate: number | null;
}

export function DeptPerformanceChart({ rows }: { rows: DeptRow[] }) {
  const data = rows
    .filter(r => r.attendance_rate !== null || r.pass_rate !== null)
    // Weakest first — the point of the chart is where attention is needed.
    .sort((a, b) => (a.attendance_rate ?? 999) - (b.attendance_rate ?? 999))
    .map(r => ({
      name: r.dept_name.length > 18 ? r.dept_name.slice(0, 17) + '…' : r.dept_name,
      Attendance: r.attendance_rate,
      'Pass rate': r.pass_rate,
    }));

  if (!data.length) return <Empty text="No attendance or marks recorded yet." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 52)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, bottom: 4, left: 4 }} barGap={2}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: AXIS }}
               axisLine={false} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="name" width={130}
               tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
        <Tooltip content={<VizTooltip suffix="%" />} cursor={{ fill: 'var(--viz-hover)' }} />
        <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" iconSize={8} />
        {/* 50% is the pass mark — the line is what makes a bar meaningful. */}
        <ReferenceLine x={50} stroke={AXIS} strokeDasharray="3 3" />
        <Bar dataKey="Attendance" fill={S1} radius={[0, 4, 4, 0]} maxBarSize={13}>
          <LabelList dataKey="Attendance" position="right" formatter={(v: number) => v == null ? '—' : `${v}%`}
                     style={{ fontSize: 10, fill: 'var(--text2)' }} />
        </Bar>
        <Bar dataKey="Pass rate" fill={S3} radius={[0, 4, 4, 0]} maxBarSize={13}>
          <LabelList dataKey="Pass rate" position="right" formatter={(v: number) => v == null ? '—' : `${v}%`}
                     style={{ fontSize: 10, fill: 'var(--text2)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── A breakdown, as a donut ─────────────────────────────────────────────────

export function BreakdownDonut({ data, suffix = '' }: {
  data: { name: string; value: number }[];
  suffix?: string;
}) {
  // Only three hues validate all-pairs, and a pie shows every pair at once —
  // so anything past the third folds into "Other" rather than inventing a hue.
  const sorted = [...data].filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, 3);
  const rest = sorted.slice(3).reduce((sum, d) => sum + d.value, 0);
  const slices = rest > 0 ? [...shown, { name: 'Other', value: rest }] : shown;
  const total = slices.reduce((s, d) => s + d.value, 0);

  if (!total) return <Empty text="Nothing recorded yet." />;

  const fills = [S1, S2, S3, 'var(--viz-other)'];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <ResponsiveContainer width="100%" height={190} minWidth={180}>
        <PieChart>
          <Tooltip content={<VizTooltip suffix={suffix} />} />
          <Pie
            data={slices} dataKey="value" nameKey="name"
            innerRadius="58%" outerRadius="82%" paddingAngle={2}
            /* 2px surface ring between segments — the spacer, not a border. */
            stroke={SURFACE} strokeWidth={2}
          >
            {slices.map((_, i) => <Cell key={i} fill={fills[i]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {/* Direct labels, always. Identity is never colour alone, and the light
          aqua sits below 3:1 so the relief rule requires visible values. */}
      <div style={{ display: 'grid', gap: 6, minWidth: 150, flex: '1 1 150px' }}>
        {slices.map((d, i) => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: fills[i], flexShrink: 0 }} />
            <span style={{ color: 'var(--text2)', textTransform: 'capitalize' }}>
              {d.name.replace(/_/g, ' ')}
            </span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>
              {d.value}{suffix}
            </span>
            <span style={{ color: 'var(--text3)', fontSize: 11, width: 38, textAlign: 'right' }}>
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── A student's module marks against the pass line ──────────────────────────

export function ModuleMarksChart({ data }: { data: { name: string; mark: number }[] }) {
  if (!data.length) return <Empty text="No marks recorded yet." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 46)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: AXIS }}
               axisLine={false} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="name" width={140}
               tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} />
        <Tooltip content={<VizTooltip suffix="%" />} cursor={{ fill: 'var(--viz-hover)' }} />
        <ReferenceLine x={50} stroke={AXIS} strokeDasharray="3 3"
                       label={{ value: 'Pass', position: 'top', fontSize: 10, fill: 'var(--text3)' }} />
        {/* One series, so no legend — the panel title names it. Pass and fail
            are STATUS, not categorical identity, so they use the status palette
            and are never mistaken for two data series. */}
        <Bar dataKey="mark" radius={[0, 4, 4, 0]} maxBarSize={16}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.mark >= 50 ? 'var(--viz-good)' : 'var(--viz-bad)'} />
          ))}
          <LabelList dataKey="mark" position="right" formatter={(v: number) => `${v}%`}
                     style={{ fontSize: 11, fill: 'var(--text2)', fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Attendance over time ────────────────────────────────────────────────────

/**
 * Attendance week by week.
 *
 * A single percentage cannot show a decline; a sequence can. Attendance also
 * falls before marks do, so this is the earliest warning the data holds — which
 * is the whole reason it is a line and not another counter.
 *
 * One series, so no legend: the panel title names it. 2px stroke, 8px markers,
 * and a dashed line at the 75% at-risk threshold — without that line a reader
 * has no way to tell a good week from a bad one.
 */
export function TrendChart({ data, threshold = 75 }: {
  data: { label: string; rate: number | null }[];
  threshold?: number;
}) {
  if (data.length < 2) {
    return <Empty text="Not enough weeks of registers yet to show a trend." />;
  }

  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: AXIS }} axisLine={false} tickLine={false} unit="%" />
        <Tooltip content={<VizTooltip suffix="%" />} cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} />
        <ReferenceLine y={threshold} stroke={AXIS} strokeDasharray="3 3"
                       label={{ value: `${threshold}% target`, position: 'insideTopRight', fontSize: 10, fill: 'var(--text3)' }} />
        <Line type="monotone" dataKey="rate" name="Attendance" stroke={S1} strokeWidth={2}
              dot={{ r: 4, fill: S1, strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Weakest modules ─────────────────────────────────────────────────────────

/**
 * Pass rate per module-in-a-class, weakest first.
 *
 * The unit is module × class deliberately. A module that fails in every class
 * is a curriculum or assessment problem; the same module failing in one class
 * is a teaching or timetable problem. Aggregating them away hides exactly the
 * distinction the reader needs to act.
 *
 * Pass and fail are STATUS, so they use the status palette and are never
 * mistaken for two data series.
 */
export function ModulePerformanceChart({ data }: {
  data: { name: string; sub: string; rate: number }[];
}) {
  if (!data.length) return <Empty text="No marks recorded yet." />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 46, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: AXIS }}
               axisLine={false} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="name" width={165}
               tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} />
        <Tooltip content={<VizTooltip suffix="%" />} cursor={{ fill: 'var(--viz-hover)' }} />
        <ReferenceLine x={50} stroke={AXIS} strokeDasharray="3 3" />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]} maxBarSize={14}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.rate >= 50 ? 'var(--viz-good)' : 'var(--viz-bad)'} />
          ))}
          <LabelList dataKey="rate" position="right" formatter={(v: number) => `${v}%`}
                     style={{ fontSize: 10, fill: 'var(--text2)', fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
