// Chart components — Build 4. Lazy-loaded from App.tsx so the
// Recharts bundle does not weigh down the panel's first paint; the
// score hero renders a skeleton until this chunk arrives. Charts
// use fixed sizes (no ResponsiveContainer) so they render
// deterministically in the side panel. Every chart is wrapped in a
// labelled region with a text equivalent — a chart never carries
// information that exists only as colour or shape.

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';

import type { ActivityData, CommitSample } from '../../src/domain/activity';
import type { LanguageBreakdown } from '../../src/domain/repository';
import type { TrajectoryResult } from '../../src/analysis/trajectory';

/** Distinct, colour-blind-friendlier palette for chart slices/bars.
 *  Colour is decorative here: every chart has a text legend. */
export const CHART_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#39c5cf', '#f0883e', '#ff7b72'];

export function gradeColor(score: number): string {
  if (score >= 75) return '#3fb950';
  if (score >= 60) return '#d29922';
  return '#f85149';
}

/** Score gauge: a full-circle ring filled to the score, with the
 *  number and grade overlaid as text in the centre. */
export function ScoreGauge({ score, grade, gradeText }: { score: number; grade: string; gradeText: string }) {
  const data = [
    { name: 'Score', value: score },
    { name: 'Remaining', value: 100 - score },
  ];
  return (
    <div
      className="score-gauge"
      role="img"
      aria-label={`Health score ${score} out of 100, grade ${grade} ${gradeText}`}
    >
      <PieChart width={180} height={180}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx={90}
          cy={90}
          innerRadius={68}
          outerRadius={86}
          startAngle={90}
          endAngle={-270}
          strokeWidth={0}
          isAnimationActive={false}
        >
          <Cell fill={gradeColor(score)} />
          <Cell fill="var(--chart-track)" />
        </Pie>
      </PieChart>
      <div className="score-gauge-center" aria-hidden="true">
        <span className="score-number">{score}</span>
        <span className="score-grade">
          {grade} · {gradeText}
        </span>
      </div>
    </div>
  );
}

export interface WeekBucket {
  week: string;
  commits: number;
}

/** Bucket a commit sample into the last 12 weekly buckets, oldest
 *  first. Commits outside the 12-week window are ignored; the
 *  sample window is 90 days, so the first bucket is partial. */
export function weeklyCommitBuckets(commits: CommitSample[], nowMs: number): WeekBucket[] {
  const dayMs = 86_400_000;
  const weekStart = (d: Date) => {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - copy.getDay()); // week starts Sunday
    return copy.getTime();
  };
  const nowWeek = weekStart(new Date(nowMs));
  const buckets: WeekBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = nowWeek - i * 7 * dayMs;
    buckets.push({
      week: new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      commits: 0,
    });
  }
  for (const commit of commits) {
    if (!commit.committedAt) continue;
    const at = new Date(commit.committedAt).getTime();
    if (Number.isNaN(at)) continue;
    const idx = 11 - Math.floor((nowWeek - weekStart(new Date(at))) / (7 * dayMs));
    const bucket = buckets[idx];
    if (bucket) bucket.commits += 1;
  }
  return buckets;
}

/** Weekly commit bars for the last 12 weeks, from the 90-day
 *  commit sample. The caller labels truncation next to the chart. */
export function ActivityChart({ activity, nowMs }: { activity: ActivityData; nowMs: number }) {
  const commits = activity.commits ?? [];
  const data = weeklyCommitBuckets(commits, nowMs);
  const total = data.reduce((sum, b) => sum + b.commits, 0);
  return (
    <div
      className="activity-chart"
      role="img"
      aria-label={`Weekly commits over the last 12 weeks, ${total} commits in the sample`}
    >
      <BarChart width={320} height={150} data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--muted)' }} interval={2} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
        <Tooltip
          formatter={(value) => [`${value} commits`, 'Commits']}
          labelFormatter={(label) => `Week of ${label}`}
        />
        <Bar dataKey="commits" fill="#58a6ff" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
      <p className="muted small chart-note">
        {total} commits in the 90-day sample, grouped by week.
      </p>
    </div>
  );
}

/** Language donut: top 5 languages plus "Other", with a text
 *  legend carrying every name and percentage. */
export function LanguageDonut({ languages }: { languages: LanguageBreakdown }) {
  const top = languages.entries.slice(0, 5);
  const otherPercent = Math.max(0, 100 - top.reduce((sum, e) => sum + e.percent, 0));
  const data = top.map((e) => ({ name: e.name, value: e.percent }));
  if (otherPercent > 0 && languages.entries.length > 5) {
    data.push({ name: 'Other', value: Math.round(otherPercent * 10) / 10 });
  }
  return (
    <div
      className="language-donut"
      role="img"
      aria-label={`Language distribution: ${data.map((d) => `${d.name} ${d.value} percent`).join(', ')}`}
    >
      <PieChart width={300} height={150}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx={75}
          cy={75}
          innerRadius={42}
          outerRadius={66}
          strokeWidth={0}
          isAnimationActive={false}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => [`${value}%`, 'Share']} />
      </PieChart>
      <ul className="donut-legend" aria-label="Languages by share">
        {data.map((entry, i) => (
          <li key={entry.name}>
            <span
              className="legend-swatch"
              style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              aria-hidden="true"
            />
            {entry.name} — {entry.value}%
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 52-week trajectory chart — 0.3.0. Weekly commit bars with the
 *  least-squares trend line overlaid. The text next to the chart
 *  (in App.tsx) carries the trend label, slope and forecast — the
 *  chart never carries information that exists only as shape. */
export function TrajectoryChart({ trajectory }: { trajectory: TrajectoryResult }) {
  const data = trajectory.weeks.map((w, i) => ({
    week: new Date(w.week * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    commits: w.total,
    trend: trajectory.trendLine[i] ?? null,
  }));
  const total = data.reduce((sum, d) => sum + d.commits, 0);
  return (
    <div
      className="activity-chart"
      role="img"
      aria-label={`Weekly commits over the last ${trajectory.weeksUsed} weeks, ${total} commits in total, with the trend line`}
    >
      <ComposedChart width={320} height={150} data={data} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--muted)' }} interval={7} />
        <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
        <Tooltip
          formatter={(value, name) => [
            `${value} commits`,
            name === 'trend' ? 'Trend line' : 'Commits',
          ]}
          labelFormatter={(label) => `Week of ${label}`}
        />
        <Bar dataKey="commits" fill="#58a6ff" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        <Line
          type="linear"
          dataKey="trend"
          stroke="#17e6c8"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
      <p className="muted small chart-note">
        {total} commits over {trajectory.weeksUsed} weeks (GitHub commit activity).
      </p>
    </div>
  );
}
