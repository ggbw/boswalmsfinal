/**
 * Role-specific dashboards.
 *
 * Each answers the question that role actually opens the system to ask:
 *   Principal / Deputy  how is the school doing?
 *   HOA                 the same, across the whole school's academics
 *   HOD                 how is my department doing, and what needs chasing?
 *   Lecturer            what is waiting on me?
 *
 * All figures come from database aggregates (see useDashboardStats), so a
 * school-wide view costs one small request rather than downloading every mark
 * and attendance row into the browser.
 */

import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import {
  useSchoolStats, useDepartmentStats, useLecturerStats,
  useModulePerformance, useAttendanceTrend, useAtRisk,
  type DepartmentStats,
} from '@/hooks/useDashboardStats';
import { resolveDepartment } from '@/lib/scope';
import { DeptPerformanceChart, BreakdownDonut, TrendChart, ModulePerformanceChart } from '@/components/charts/DashboardCharts';

// ── Shared pieces ───────────────────────────────────────────────────────────

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);

/** Attendance and pass rates are read at a glance, so colour carries the meaning. */
function rateColor(v: number | null | undefined) {
  if (v === null || v === undefined) return 'var(--text2)';
  if (v >= 75) return '#1a7f37';
  if (v >= 50) return '#9a6700';
  return '#cf222e';
}

function Stat({ value, label, icon, bg, color, tone }: {
  value: string | number; label: string; icon: string;
  bg?: string; color?: string; tone?: 'good' | 'warn' | 'bad';
}) {
  const toneColor = tone === 'bad' ? '#cf222e' : tone === 'warn' ? '#9a6700' : tone === 'good' ? '#1a7f37' : undefined;
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ background: bg || 'var(--bg2)' }}>
        <i className={icon} style={{ color: color || 'var(--text2)' }} />
      </div>
      <div>
        <div className="stat-val" style={{ color: toneColor }}>{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function Panel({ title, icon, children, action }: {
  title: string; icon: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-title">
        <span><i className={icon} /> {title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: 'var(--text2)', fontSize: 12, padding: '12px 0' }}>{text}</div>;
}

function Loading() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>
      <i className="fa-solid fa-spinner fa-spin" style={{ marginRight: 8 }} /> Loading…
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="card" style={{ padding: 16, color: '#cf222e', fontSize: 13 }}>
      <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 8 }} />
      This dashboard could not be loaded: {message}
    </div>
  );
}

/** Departments ranked worst-first on a rate — where attention is needed. */
function DeptTable({ rows, metric }: { rows: DepartmentStats[]; metric: 'attendance_rate' | 'pass_rate' }) {
  const sorted = [...rows].sort((a, b) => {
    const av = a[metric], bv = b[metric];
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  });
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Department</th><th style={{ textAlign: 'center' }}>Students</th><th style={{ textAlign: 'center' }}>Attendance</th><th style={{ textAlign: 'center' }}>Pass rate</th></tr></thead>
        <tbody>
          {sorted.map(d => (
            <tr key={d.dept_id}>
              <td className="td-name">{d.dept_name}</td>
              <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace" }}>{d.students}</td>
              <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", color: rateColor(d.attendance_rate), fontWeight: 700 }}>{pct(d.attendance_rate)}</td>
              <td style={{ textAlign: 'center', fontFamily: "'JetBrains Mono',monospace", color: rateColor(d.pass_rate), fontWeight: 700 }}>{pct(d.pass_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Analysis shared by principal, deputy, HOA and HOD ───────────────────────

/**
 * The panels that support a decision rather than describe the school.
 *
 * Three questions, in the order they get asked:
 *
 *   1. Is attendance drifting?  — a trend, because a single percentage cannot
 *      show a decline, and attendance falls before marks do.
 *   2. What is going wrong, and where?  — pass rate per module IN A CLASS. A
 *      module weak in every class is a curriculum problem; the same module weak
 *      in one class is a teaching or timetable problem. Aggregating them hides
 *      the distinction that decides who you talk to.
 *   3. Who do we act on?  — students by name. A percentage cannot be acted on.
 *
 * A HOD passes their own department as `lockedDept` and the filter disappears:
 * the scope is not theirs to change. Everyone else can move between
 * departments, which is what makes one department's numbers mean anything —
 * 62% is good or bad only next to the others.
 */
function AnalyticsSection({ lockedDept }: { lockedDept?: string | null }) {
  const { navigate } = useApp();
  const [dept, setDept]   = useState<string>(lockedDept || 'all');
  const [weeks, setWeeks] = useState(12);

  const perf   = useModulePerformance();
  const trend  = useAttendanceTrend(weeks);
  const atRisk = useAtRisk();

  const effectiveDept = lockedDept || dept;
  const inScope = <T extends { dept_id?: string | null }>(rows: T[] | null) =>
    (rows || []).filter(r => effectiveDept === 'all' || r.dept_id === effectiveDept);

  // Department list comes from the performance rows, so it can only ever offer
  // departments that actually have data behind them.
  const deptOptions = Array.from(
    new Map((perf.data || [])
      .filter(r => r.dept_id)
      .map(r => [r.dept_id as string, r.dept_name || r.dept_id as string])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]));

  // Trend: several departments report in the same week, so sum first and take
  // the rate from the totals. Averaging the per-department rates would weight a
  // department of nine the same as one of ninety.
  const byWeek = new Map<string, { present: number; sessions: number }>();
  inScope(trend.data).forEach(r => {
    const acc = byWeek.get(r.week_start) || { present: 0, sessions: 0 };
    acc.present += Number(r.present) || 0;
    acc.sessions += Number(r.sessions) || 0;
    byWeek.set(r.week_start, acc);
  });
  const trendData = Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([wk, v]) => ({
      label: new Date(wk).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      rate: v.sessions ? Math.round((v.present / v.sessions) * 1000) / 10 : null,
    }));

  // Only modules that have been marked. A module with no marks has a null pass
  // rate, and showing it as 0% would report "everyone failed" when the truth is
  // "nobody has marked it".
  const weakest = inScope(perf.data)
    .filter(r => r.marks_recorded > 0 && r.pass_rate !== null)
    .sort((a, b) => (a.pass_rate ?? 100) - (b.pass_rate ?? 100))
    .slice(0, 12);

  const unmarked = inScope(perf.data).filter(r => r.unmarked_assessments > 0);
  const risk = (atRisk.data || []).filter(r =>
    effectiveDept === 'all' ||
    deptOptions.find(([id]) => id === effectiveDept)?.[1] === r.dept_name);

  const label = (r: { module_name: string; class_name: string }) => {
    const m = r.module_name.length > 20 ? r.module_name.slice(0, 19) + '…' : r.module_name;
    return `${m} · ${r.class_name}`;
  };

  return (
    <>
      {/* Filters in one row above the charts, so the scope of everything below
          is visible without hunting for it. */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 14px' }}>
        {!lockedDept && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
            Department
            <select className="form-select" style={{ width: 'auto', minWidth: 160, padding: '5px 8px', fontSize: 12 }}
                    value={dept} onChange={e => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {deptOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}>
          Period
          <select className="form-select" style={{ width: 'auto', padding: '5px 8px', fontSize: 12 }}
                  value={weeks} onChange={e => setWeeks(Number(e.target.value))}>
            <option value={4}>Last 4 weeks</option>
            <option value={8}>Last 8 weeks</option>
            <option value={12}>Last 12 weeks</option>
            <option value={26}>Last 26 weeks</option>
          </select>
        </label>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
          {risk.length} student(s) flagged · {unmarked.length} module(s) part-marked
        </div>
      </div>

      <Panel title="Attendance over time" icon="fa-solid fa-chart-line">
        {trend.loading ? <Empty text="Loading…" />
          : trend.error ? <Empty text={`Could not load: ${trend.error}`} />
          : <TrendChart data={trendData} threshold={75} />}
      </Panel>

      <div className="two-col">
        <Panel title="Weakest modules — by class" icon="fa-solid fa-arrow-trend-down"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('reports')}>Reports</button>}>
          {perf.loading ? <Empty text="Loading…" />
            : perf.error ? <Empty text={`Could not load: ${perf.error}`} />
            : !weakest.length ? <Empty text="No marks recorded yet." />
            : (
              <>
                <ModulePerformanceChart
                  data={weakest.map(r => ({ name: label(r), sub: r.lecturers, rate: r.pass_rate as number }))}
                />
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>Show as a table</summary>
                  <table className="data-table" style={{ marginTop: 8, fontSize: 11 }}>
                    <thead><tr><th>Module</th><th>Class</th><th>Taught by</th><th>Marks</th><th>Avg</th><th>Pass</th><th>Att.</th></tr></thead>
                    <tbody>
                      {weakest.map(r => (
                        <tr key={r.module_id + r.class_id}>
                          <td>{r.module_name}</td><td>{r.class_name}</td><td>{r.lecturers}</td>
                          <td>{r.marks_recorded}</td><td>{pct(r.avg_mark)}</td>
                          <td style={{ color: (r.pass_rate ?? 0) >= 50 ? 'var(--viz-good)' : 'var(--viz-bad)', fontWeight: 700 }}>{pct(r.pass_rate)}</td>
                          <td>{pct(r.attendance_rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                {unmarked.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
                    {unmarked.length} module(s) in scope still have assessments with no marks entered.
                    Pass rates above are computed only from what has been marked.
                  </div>
                )}
              </>
            )}
        </Panel>

        <Panel title="Students at risk" icon="fa-solid fa-user-clock"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('students')}>Students</button>}>
          {atRisk.loading ? <Empty text="Loading…" />
            : atRisk.error ? <Empty text={`Could not load: ${atRisk.error}`} />
            : !risk.length ? <Empty text="No student is currently below the thresholds." />
            : (
              <>
                <table className="data-table" style={{ fontSize: 11 }}>
                  <thead><tr><th>Student</th><th>Class</th><th>Avg</th><th>Att.</th><th>Why</th></tr></thead>
                  <tbody>
                    {risk.slice(0, 15).map(r => (
                      <tr key={r.student_id}>
                        <td><strong>{r.student_name}</strong><div style={{ color: 'var(--text3)' }}>{r.student_id}</div></td>
                        <td>{r.class_name}</td>
                        <td style={{ color: (r.avg_mark ?? 100) < 50 ? 'var(--viz-bad)' : undefined, fontWeight: 700 }}>{pct(r.avg_mark)}</td>
                        <td style={{ color: (r.attendance_rate ?? 100) < 75 ? 'var(--viz-bad)' : undefined }}>{pct(r.attendance_rate)}</td>
                        <td style={{ color: 'var(--text2)' }}>{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {risk.length > 15 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)' }}>
                    Showing the 15 most at risk of {risk.length}.
                  </div>
                )}
              </>
            )}
        </Panel>
      </div>
    </>
  );
}

// ── Principal / Deputy Principal ────────────────────────────────────────────

export function PrincipalDashboard({ academicOnly }: { academicOnly: boolean }) {
  const { db, currentUser, navigate } = useApp();
  const school = useSchoolStats();
  const depts = useDepartmentStats();

  if (school.loading) return <Loading />;
  if (school.error) return <ErrorCard message={school.error} />;
  const s = school.data;
  if (!s) return <ErrorCard message="No statistics returned." />;

  const marking = s.assessments_set > 0
    ? Math.round((s.assessments_marked / s.assessments_set) * 100) : null;
  // Operational faults are the ones that silently make the system look broken to
  // whoever they affect, so they get their own panel rather than being buried.
  const faults = s.classes_no_modules + s.staff_no_modules + s.students_no_login;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">
            {academicOnly ? 'Academic Overview' : 'School Overview'}
          </div>
          <div className="page-sub">
            {currentUser?.name} · {db.config.schoolName} · Year {db.config.currentYear} Semester {db.config.currentSemester}
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <Stat value={s.active_students} label="Active Students" icon="fa-solid fa-user-graduate" bg="#fff0cc" color="#d4920a" />
        <Stat value={s.teaching_staff} label="Teaching Staff" icon="fa-solid fa-chalkboard-user" bg="#e8f4fd" color="#2563eb" />
        <Stat value={s.classes} label="Classes" icon="fa-solid fa-school" bg="#f0ffe8" color="#1a7f37" />
        <Stat value={pct(s.attendance_rate)} label="Attendance" icon="fa-solid fa-circle-check" bg="#f0fff4" color="#1a7f37"
              tone={s.attendance_rate === null ? undefined : s.attendance_rate >= 75 ? 'good' : s.attendance_rate >= 50 ? 'warn' : 'bad'} />
        <Stat value={pct(s.pass_rate)} label="Pass Rate" icon="fa-solid fa-award" bg="#fdf0ff" color="#8250df"
              tone={s.pass_rate === null ? undefined : s.pass_rate >= 75 ? 'good' : s.pass_rate >= 50 ? 'warn' : 'bad'} />
        <Stat value={marking === null ? '—' : `${marking}%`} label="Assessments Marked" icon="fa-solid fa-list-check" bg="#ddf4ff" color="#0550ae" />
      </div>

      <div className="two-col">
        <Panel title="Departments — weakest first" icon="fa-solid fa-building-columns"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('reports')}>Reports</button>}>
          {depts.loading ? <Empty text="Loading departments…" />
            : depts.error ? <Empty text={`Could not load: ${depts.error}`} />
            : !depts.data?.length ? <Empty text="No departments configured." />
            : (
              <>
                <DeptPerformanceChart rows={depts.data} />
                {/* The table stays: it is the accessible view of the same data,
                    and it carries the columns the chart does not. */}
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>
                    Show as a table
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <DeptTable rows={depts.data} metric="attendance_rate" />
                  </div>
                </details>
              </>
            )}
        </Panel>

        <Panel title="Needs attention" icon="fa-solid fa-triangle-exclamation">
          {faults === 0
            ? <Empty text="Nothing outstanding — every class has modules, every lecturer has assignments, and every active student has a login." />
            : (
              <div style={{ display: 'grid', gap: 10, paddingTop: 6 }}>
                {s.classes_no_modules > 0 && (
                  <div className="info-row">
                    <span className="info-label">Classes with no modules linked</span>
                    <span className="info-val" style={{ color: '#cf222e', fontWeight: 700 }}>{s.classes_no_modules}</span>
                  </div>
                )}
                {s.staff_no_modules > 0 && (
                  <div className="info-row">
                    <span className="info-label">Teaching staff with no modules assigned</span>
                    <span className="info-val" style={{ color: '#cf222e', fontWeight: 700 }}>{s.staff_no_modules}</span>
                  </div>
                )}
                {s.students_no_login > 0 && (
                  <div className="info-row">
                    <span className="info-label">Active students with no login account</span>
                    <span className="info-val" style={{ color: '#cf222e', fontWeight: 700 }}>{s.students_no_login}</span>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  Each of these silently makes the system look broken to whoever it affects.
                </div>
              </div>
            )}
        </Panel>
      </div>

      {/* The deputy's remit is academic, so the admissions pipeline is the
          principal's panel only. */}
      {!academicOnly && (
        <Panel title="Admissions pipeline" icon="fa-solid fa-door-open"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('admissions')}>Open</button>}>
          {Object.keys(s.applications || {}).length === 0
            ? <Empty text="No applications recorded." />
            : (
              <BreakdownDonut
                data={Object.entries(s.applications).map(([name, value]) => ({ name, value }))}
              />
            )}
        </Panel>
      )}

      {/* The counters above say how big the school is. This says what to do
          about it — and it is the same analysis a HOD sees, scoped wider, so
          the two are talking about the same numbers when they meet. */}
      <AnalyticsSection />
    </>
  );
}

// ── Head of Department ──────────────────────────────────────────────────────

export function HodDashboard() {
  const { db, currentUser, navigate } = useApp();
  const depts = useDepartmentStats();
  const dept = resolveDepartment(db, currentUser);
  const mine = depts.data?.find(d => d.dept_id === dept?.id) ?? null;

  if (depts.loading) return <Loading />;
  if (depts.error) return <ErrorCard message={depts.error} />;

  // A HOD whose department can't be resolved would otherwise see a blank page
  // with no explanation — this is a real failure mode, since the link is made by
  // matching a display name.
  if (!dept) {
    return (
      <>
        <div className="page-header"><div className="page-title">My Department</div></div>
        <div className="card" style={{ padding: 24, color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>
          <i className="fa-solid fa-circle-info" style={{ marginRight: 8 }} />
          We couldn't work out which department you head. An administrator can fix this by setting
          your department on your profile, or naming you as HOD on the department record.
        </div>
      </>
    );
  }

  const modules = db.modules.filter(m => m.dept === dept.id);

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{dept.name}</div>
          <div className="page-sub">{currentUser?.name} · Head of Department · Semester {db.config.currentSemester} {db.config.currentYear}</div>
        </div>
      </div>

      <div className="stat-grid">
        <Stat value={mine?.students ?? 0} label="Students" icon="fa-solid fa-user-graduate" bg="#fff0cc" color="#d4920a" />
        <Stat value={mine?.modules ?? modules.length} label="Modules" icon="fa-solid fa-book-open" bg="#fdf0ff" color="#8250df" />
        <Stat value={mine?.lecturers ?? 0} label="Lecturers" icon="fa-solid fa-chalkboard-user" bg="#e8f4fd" color="#2563eb" />
        <Stat value={pct(mine?.attendance_rate)} label="Attendance" icon="fa-solid fa-circle-check" bg="#f0fff4" color="#1a7f37"
              tone={mine?.attendance_rate == null ? undefined : mine.attendance_rate >= 75 ? 'good' : mine.attendance_rate >= 50 ? 'warn' : 'bad'} />
        <Stat value={pct(mine?.pass_rate)} label="Pass Rate" icon="fa-solid fa-award" bg="#f0e6ff" color="#6639ba"
              tone={mine?.pass_rate == null ? undefined : mine.pass_rate >= 75 ? 'good' : mine.pass_rate >= 50 ? 'warn' : 'bad'} />
        <Stat value={mine?.marks_recorded ?? 0} label="Marks Recorded" icon="fa-solid fa-pen-to-square" bg="#ddf4ff" color="#0550ae" />
      </div>

      <div className="two-col">
        <Panel title="Modules in this department" icon="fa-solid fa-book-open"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('mapping')}>Mapping</button>}>
          {modules.length === 0
            ? <Empty text="No modules are linked to this department yet." />
            : (
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Module</th><th>Lecturer(s)</th></tr></thead>
                  <tbody>
                    {modules.map(m => {
                      const ids = [...new Set(db.lecturerModules.filter(lm => lm.moduleId === m.id).map(lm => lm.lecturerId))];
                      const names = ids.map(id => db.users.find(u => u.id === id)?.name).filter(Boolean);
                      return (
                        <tr key={m.id}>
                          <td className="td-name">{m.name}</td>
                          <td style={{ color: names.length ? undefined : '#cf222e' }}>
                            {names.length ? names.join(', ') : 'Not assigned'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </Panel>

        <Panel title="How the department compares" icon="fa-solid fa-chart-column"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('reports')}>Reports</button>}>
          {!depts.data?.length ? <Empty text="No comparison available." /> : (
            <>
              <DeptPerformanceChart rows={depts.data} />
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>Show as a table</summary>
                <div style={{ marginTop: 8 }}><DeptTable rows={depts.data} metric="attendance_rate" /></div>
              </details>
            </>
          )}
        </Panel>
      </div>

      {/* Locked to this department — the scope is not the HOD's to change, but
          it is the same analysis the principal sees, so both are reading the
          same numbers when they discuss them. */}
      <AnalyticsSection lockedDept={dept.id} />
    </>
  );
}

// ── Lecturer ────────────────────────────────────────────────────────────────

export function LecturerDashboard() {
  const { db, currentUser, navigate } = useApp();
  const { data, loading, error } = useLecturerStats();

  if (loading) return <Loading />;
  if (error) return <ErrorCard message={error} />;
  const s = data;

  // The commonest lecturer complaint in this system is "I can't see anything",
  // and the cause is almost always no module assignments. Say so plainly.
  if (!s || s.modules === 0) {
    return (
      <>
        <div className="page-header"><div className="page-title">Welcome, {currentUser?.name?.split(' ')[0]}</div></div>
        <div className="card" style={{ padding: 24, color: 'var(--text2)', fontSize: 13, lineHeight: 1.6 }}>
          <i className="fa-solid fa-circle-info" style={{ marginRight: 8 }} />
          You don't have any modules assigned yet, so there are no classes, students or registers to show.
          An administrator can assign them under <strong>Classes → Assign lecturers</strong>.
        </div>
      </>
    );
  }

  const todo = s.ungraded_submissions + s.unmarked_assessments;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Welcome, {currentUser?.name?.split(' ')[0]}</div>
          <div className="page-sub">{s.modules} module(s) across {s.classes} class(es) · {s.students} students</div>
        </div>
      </div>

      <div className="stat-grid">
        <Stat value={s.ungraded_submissions} label="Submissions to Mark" icon="fa-solid fa-inbox" bg="#ddf4ff" color="#0550ae"
              tone={s.ungraded_submissions > 0 ? 'warn' : 'good'} />
        <Stat value={s.unmarked_assessments} label="Assessments Unmarked" icon="fa-solid fa-pen-to-square" bg="#fff3cc" color="#d4920a"
              tone={s.unmarked_assessments > 0 ? 'warn' : 'good'} />
        <Stat value={s.students} label="My Students" icon="fa-solid fa-users" bg="#fff0cc" color="#d4920a" />
        <Stat value={s.registers_last_14d} label="Registers (14 days)" icon="fa-solid fa-clipboard-check" bg="#f0ffe8" color="#1a7f37"
              tone={s.registers_last_14d === 0 ? 'bad' : undefined} />
        <Stat value={pct(s.attendance_rate)} label="Class Attendance" icon="fa-solid fa-circle-check" bg="#f0fff4" color="#1a7f37"
              tone={s.attendance_rate == null ? undefined : s.attendance_rate >= 75 ? 'good' : s.attendance_rate >= 50 ? 'warn' : 'bad'} />
      </div>

      <div className="two-col">
        <Panel title="Waiting on you" icon="fa-solid fa-list-check">
          {todo === 0
            ? <Empty text="Nothing outstanding — every submission is graded and every assessment has marks." />
            : (
              <div style={{ display: 'grid', gap: 10, paddingTop: 6 }}>
                {s.ungraded_submissions > 0 && (
                  <div className="info-row">
                    <span className="info-label">Student submissions with no grade</span>
                    <span className="info-val">
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('assignments')}>
                        {s.ungraded_submissions} to mark
                      </button>
                    </span>
                  </div>
                )}
                {s.unmarked_assessments > 0 && (
                  <div className="info-row">
                    <span className="info-label">Assessments set with no marks entered</span>
                    <span className="info-val">
                      <button className="btn btn-outline btn-sm" onClick={() => navigate('exams')}>
                        {s.unmarked_assessments} outstanding
                      </button>
                    </span>
                  </div>
                )}
              </div>
            )}
          {s.registers_last_14d === 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#9a6700', background: '#fff8c5', borderRadius: 6, padding: '8px 12px' }}>
              <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
              No registers taken in the last 14 days.{' '}
              <button className="btn btn-outline btn-sm" style={{ marginLeft: 6 }} onClick={() => navigate('attendance')}>
                Take a register
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Outstanding marking" icon="fa-solid fa-chart-pie">
          {/* What is LEFT, split by kind — not a progress ring. The stats
              function counts only outstanding work; there is no "done" figure
              to divide by, and a denominator built out of the student count
              would be a different quantity wearing the same label. Two honest
              slices beat a percentage of nothing. */}
          {todo === 0
            ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: 8, height: 190, color: 'var(--viz-good)', fontSize: 13, fontWeight: 600 }}>
                <i className="fa-solid fa-circle-check" /> All marking is up to date
              </div>
            : <BreakdownDonut
                data={[
                  { name: 'Submissions to grade', value: s.ungraded_submissions },
                  { name: 'Assessments not started', value: s.unmarked_assessments },
                ]}
              />}
        </Panel>

        <Panel title="My modules" icon="fa-solid fa-book-open"
               action={<button className="btn btn-outline btn-sm" onClick={() => navigate('mystudents')}>My Students</button>}>
          {(() => {
            const rows = db.lecturerModules.filter(lm => lm.lecturerId === currentUser?.id);
            if (rows.length === 0) return <Empty text="No modules assigned." />;
            return (
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Module</th><th>Class</th></tr></thead>
                  <tbody>
                    {rows.map(lm => (
                      <tr key={lm.id}>
                        <td className="td-name">{db.modules.find(m => m.id === lm.moduleId)?.name || lm.moduleId}</td>
                        <td>{db.classes.find(c => c.id === lm.classId)?.name || lm.classId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </Panel>
      </div>
    </>
  );
}
