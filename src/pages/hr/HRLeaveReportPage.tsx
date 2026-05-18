import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { supabase } from '@/integrations/supabase/client';
import { fmtDate } from '@/lib/hr/leaveUtils';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Download, Printer } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COLORS = ['#0D9488','#F59E0B','#EC4899','#8B5CF6','#6B7280','#EF4444','#0891B2','#059669'];

interface LeaveType { id: string; name: string; code: string | null; color: string | null; }
interface Allocation {
  id: string; employee_id: string; leave_type_id: string; year: number;
  opening_balance: number; allocated_days: number; used_days: number;
  pending_days: number; remaining_days: number;
  employees?: { employee_name?: string; department?: string; branch_name?: string } | null;
  leave_types?: { name?: string; code?: string; color?: string } | null;
}
interface Request {
  id: string; employee_id: string; leave_type_id: string | null;
  start_date: string; end_date: string; num_days: number | null; number_of_days: number;
  status: string; leave_ref: string | null;
  employees?: { employee_name?: string; department?: string; branch_name?: string } | null;
  leave_types?: { name?: string; code?: string; color?: string } | null;
}

export default function HRLeaveReportPage() {
  const { toast } = useApp();
  const currentYear = new Date().getFullYear();

  const [year, setYear]           = useState(currentYear);
  const [month, setMonth]         = useState(0);
  const [branchFilter, setBranch] = useState('all');
  const [deptFilter, setDept]     = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [empSearch, setEmpSearch] = useState('');

  const [leaveTypes, setLeaveTypes]   = useState<LeaveType[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [requests, setRequests]       = useState<Request[]>([]);
  const [loading, setLoading]         = useState(true);

  // Pagination
  const [balPage, setBalPage]         = useState(1);
  const [balPageSize, setBalPageSize] = useState(25);
  const [reqPage, setReqPage]         = useState(1);
  const [reqPageSize, setReqPageSize] = useState(25);

  // Load
  useEffect(() => {
    setLoading(true);
    void (async () => {
      const [ltRes, allocRes, reqRes] = await Promise.all([
        supabase.from('leave_types').select('id, name, code, color').eq('is_active', true).order('name'),
        (supabase.from('leave_allocations') as any)
          .select('*, employees(employee_name, branch_name, department), leave_types(name, code, color)')
          .eq('year', year),
        (supabase.from('leave_requests') as any)
          .select('*, employees!leave_requests_employee_id_fkey(employee_name, branch_name, department), leave_types(name, code, color)')
          .eq('status', 'approved'),
      ]);
      if (ltRes.error) toast(ltRes.error.message, 'error');
      setLeaveTypes((ltRes.data ?? []) as LeaveType[]);
      setAllocations((allocRes.data ?? []) as Allocation[]);
      setRequests((reqRes.data ?? []) as Request[]);
      setLoading(false);
    })();
  }, [year, toast]);

  // Derived filter options
  const branches    = useMemo(() => [...new Set(requests.map(r => r.employees?.branch_name).filter(Boolean))] as string[], [requests]);
  const departments = useMemo(() => [...new Set(requests.map(r => r.employees?.department).filter(Boolean))] as string[], [requests]);

  // Filter requests
  const filtered = useMemo(() => requests.filter(r => {
    if (month > 0 && r.start_date?.slice(5, 7) !== String(month).padStart(2, '0')) return false;
    if (branchFilter !== 'all' && r.employees?.branch_name !== branchFilter) return false;
    if (deptFilter !== 'all' && r.employees?.department !== deptFilter) return false;
    if (typeFilter !== 'all' && r.leave_type_id !== typeFilter) return false;
    if (empSearch && !(r.employees?.employee_name ?? '').toLowerCase().includes(empSearch.toLowerCase())) return false;
    return true;
  }), [requests, month, branchFilter, deptFilter, typeFilter, empSearch]);

  // Monthly trend
  const trendData = useMemo(() => MONTH_NAMES.map((m, mi) => {
    const row: Record<string, unknown> = { month: m };
    for (const lt of leaveTypes) {
      row[lt.code ?? lt.name] = filtered.filter(r =>
        r.leave_type_id === lt.id &&
        parseInt(r.start_date?.slice(5, 7) ?? '0') === mi + 1
      ).reduce((s, r) => s + (r.num_days ?? r.number_of_days ?? 0), 0);
    }
    return row;
  }), [filtered, leaveTypes]);

  // Branch breakdown
  const branchData = useMemo(() => branches.map(b => {
    const row: Record<string, unknown> = { branch: b };
    for (const lt of leaveTypes) {
      row[lt.code ?? lt.name] = filtered.filter(r => r.employees?.branch_name === b && r.leave_type_id === lt.id)
        .reduce((s, r) => s + (r.num_days ?? r.number_of_days ?? 0), 0);
    }
    return row;
  }), [branches, filtered, leaveTypes]);

  // Employee balance summary rows
  const empBalRows = useMemo(() => {
    const empMap: Record<string, { id: string; name: string; dept: string; branch: string; allocs: Record<string, Allocation> }> = {};
    for (const a of allocations) {
      const id = a.employee_id;
      if (!empMap[id]) empMap[id] = { id, name: a.employees?.employee_name ?? '—', dept: a.employees?.department ?? '—', branch: a.employees?.branch_name ?? '—', allocs: {} };
      empMap[id].allocs[a.leave_type_id] = a;
    }
    return Object.values(empMap).filter(e => !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()));
  }, [allocations, empSearch]);

  // Pagination helpers
  const balTotal      = empBalRows.length;
  const balTotalPages = Math.max(1, Math.ceil(balTotal / balPageSize));
  const balSafe       = Math.min(balPage, balTotalPages);
  const balStart      = (balSafe - 1) * balPageSize;
  const balEnd        = balStart + balPageSize;

  const reqTotal      = filtered.length;
  const reqTotalPages = Math.max(1, Math.ceil(reqTotal / reqPageSize));
  const reqSafe       = Math.min(reqPage, reqTotalPages);
  const reqStart      = (reqSafe - 1) * reqPageSize;
  const reqEnd        = reqStart + reqPageSize;

  useEffect(() => { setBalPage(1); }, [year, empSearch, balPageSize]);
  useEffect(() => { setReqPage(1); }, [year, month, branchFilter, deptFilter, typeFilter, empSearch, reqPageSize]);

  // Print
  const reportRef = useRef<HTMLDivElement>(null);
  const handlePrint = () => {
    const el = reportRef.current;
    if (!el) return;
    const prev = reqPageSize;
    setReqPage(1); setReqPageSize(100000);
    el.classList.add('printing-now');
    document.body.classList.add('printing-section');
    const restore = () => {
      el.classList.remove('printing-now');
      document.body.classList.remove('printing-section');
      setReqPageSize(prev);
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    setTimeout(() => window.print(), 150);
  };

  // Excel export
  const handleExcel = () => {
    const wb = XLSX.utils.book_new();
    const headerStyle: any = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '0D9488' }, patternType: 'solid' },
      alignment: { horizontal: 'center' },
    };
    const headers = ['Employee', 'Type', 'From', 'To', 'Days', 'Branch', 'Department'];
    const aoa: any[][] = [
      headers,
      ...filtered.map(r => [
        r.employees?.employee_name ?? '',
        r.leave_types?.name ?? '',
        r.start_date ? new Date(r.start_date).toLocaleDateString('en-GB') : '',
        r.end_date   ? new Date(r.end_date).toLocaleDateString('en-GB') : '',
        r.num_days ?? r.number_of_days ?? '',
        r.employees?.branch_name ?? '',
        r.employees?.department ?? '',
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 18 }, { wch: 18 }];
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSX.utils.encode_cell({ r: 0, c });
      if ((ws as any)[ref]) (ws as any)[ref].s = headerStyle;
    }
    XLSX.utils.book_append_sheet(wb, ws, 'Leave Report');
    const slug = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '');
    XLSX.writeFile(wb, `LeaveReport_${year}_${slug}.xlsx`);
  };

  const PagerBar = ({ page, totalPages, onPrev, onNext, start, end, total, pageSize, onSizeChange }: any) => (
    <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text2)' }}>
        Showing <b>{start + 1}</b>–<b>{Math.min(end, total)}</b> of <b>{total}</b>
        <span style={{ margin: '0 4px', color: 'var(--border)' }}>|</span>
        Rows:
        <select value={pageSize} onChange={e => onSizeChange(Number(e.target.value))} className="filter-select" style={{ padding: '2px 6px', fontSize: 11 }}>
          {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="btn btn-outline btn-sm" onClick={onPrev} disabled={page === 1} style={{ padding: '3px 8px' }}>‹</button>
        <span style={{ color: 'var(--text2)' }}>Page <b>{page}</b> / <b>{totalPages}</b></span>
        <button className="btn btn-outline btn-sm" onClick={onNext} disabled={page === totalPages} style={{ padding: '3px 8px' }}>›</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Leave Report</div>
          <div className="page-sub">HR Reports · {year}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Year</label>
            <select className="filter-select" value={year} onChange={e => setYear(Number(e.target.value))}>
              {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Month</label>
            <select className="filter-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
              <option value={0}>All Months</option>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Branch</label>
            <select className="filter-select" value={branchFilter} onChange={e => setBranch(e.target.value)}>
              <option value="all">All Branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Department</label>
            <select className="filter-select" value={deptFilter} onChange={e => setDept(e.target.value)}>
              <option value="all">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Leave Type</label>
            <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All Types</option>
              {leaveTypes.map(lt => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Employee</label>
            <input className="form-input" style={{ padding: '6px 10px', fontSize: 12, width: 160 }} placeholder="Search…" value={empSearch} onChange={e => setEmpSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>Loading…</div>
      ) : (
        <>
          {/* Section 1 — Employee Balance Summary */}
          <div className="card" style={{ padding: 0, marginBottom: 16 }}>
            <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>
              Employee Leave Balances — {year}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Branch</th>
                    <th>Department</th>
                    {leaveTypes.map(lt => (
                      <>
                        <th key={lt.id + '_a'} style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', fontSize: 10 }}>{lt.code ?? lt.name} Alloc</th>
                        <th key={lt.id + '_u'} style={{ textAlign: 'center', fontSize: 10 }}>{lt.code ?? lt.name} Used</th>
                        <th key={lt.id + '_r'} style={{ textAlign: 'center', fontSize: 10 }}>{lt.code ?? lt.name} Rem</th>
                      </>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {empBalRows.length === 0 && (
                    <tr><td colSpan={3 + leaveTypes.length * 3} style={{ textAlign: 'center', padding: 32, color: 'var(--text2)' }}>No data.</td></tr>
                  )}
                  {empBalRows.slice(balStart, balEnd).map(e => (
                    <tr key={e.id}>
                      <td className="td-name">{e.name}</td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}>{e.branch}</td>
                      <td style={{ fontSize: 11, color: 'var(--text2)' }}>{e.dept}</td>
                      {leaveTypes.map(lt => {
                        const a = e.allocs[lt.id];
                        return (
                          <>
                            <td key={lt.id + '_a'} style={{ textAlign: 'center', borderLeft: '1px solid var(--border)', fontSize: 12 }}>{a?.allocated_days ?? '—'}</td>
                            <td key={lt.id + '_u'} style={{ textAlign: 'center', fontSize: 12, color: '#dc2626' }}>{a?.used_days ?? 0}</td>
                            <td key={lt.id + '_r'} style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: (a?.remaining_days ?? 0) < 0 ? '#dc2626' : '#059669' }}>{a?.remaining_days ?? '—'}</td>
                          </>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {balTotal > 0 && (
              <PagerBar page={balSafe} totalPages={balTotalPages} onPrev={() => setBalPage(p => Math.max(1, p - 1))} onNext={() => setBalPage(p => Math.min(balTotalPages, p + 1))} start={balStart} end={balEnd} total={balTotal} pageSize={balPageSize} onSizeChange={(n: number) => setBalPageSize(n)} />
            )}
          </div>

          {/* Section 2 — Monthly Trend */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title"><span>Monthly Leave Trend — {year}</span></div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {leaveTypes.map((lt, i) => (
                  <Line key={lt.id} type="monotone" dataKey={lt.code ?? lt.name} name={lt.name}
                    stroke={lt.color ?? COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Section 3 — Leave by Branch */}
          {branchData.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title"><span>Leave Days by Branch</span></div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={branchData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {leaveTypes.map((lt, i) => (
                    <Bar key={lt.id} dataKey={lt.code ?? lt.name} name={lt.name} fill={lt.color ?? COLORS[i % COLORS.length]} stackId="a" />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Section 4 — Approved Leave Records */}
          <div ref={reportRef} className="card" style={{ padding: 0 }}>
            <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Leave Records ({filtered.length} approved)</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={handleExcel} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Download size={13} /> Excel
                </button>
                <button className="btn btn-outline btn-sm" onClick={handlePrint} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Printer size={13} /> Print / PDF
                </button>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {['Ref','Employee','Type','From','To','Days','Branch','Department'].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text2)' }}>No approved leaves for selected filters.</td></tr>
                  )}
                  {filtered.slice(reqStart, reqEnd).map(r => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text3)' }}>{r.leave_ref ?? r.id.slice(0, 8)}</td>
                      <td className="td-name">{r.employees?.employee_name ?? '—'}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: r.leave_types?.color ?? '#0D9488' }} />
                          {r.leave_types?.name ?? '—'}
                        </span>
                      </td>
                      <td>{fmtDate(r.start_date)}</td>
                      <td>{fmtDate(r.end_date)}</td>
                      <td style={{ fontWeight: 600 }}>{r.num_days ?? r.number_of_days}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 11 }}>{r.employees?.branch_name ?? '—'}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 11 }}>{r.employees?.department ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reqTotal > 0 && (
              <PagerBar page={reqSafe} totalPages={reqTotalPages} onPrev={() => setReqPage(p => Math.max(1, p - 1))} onNext={() => setReqPage(p => Math.min(reqTotalPages, p + 1))} start={reqStart} end={reqEnd} total={reqTotal} pageSize={reqPageSize} onSizeChange={(n: number) => setReqPageSize(n)} />
            )}
          </div>
        </>
      )}
    </>
  );
}
