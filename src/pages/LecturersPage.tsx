import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface FacultyRow {
  user_id: string;
  name: string;
  email: string;
  role: string;
  dept: string;
  code: string;
}

export default function LecturersPage() {
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profiles } = await supabase.from('profiles').select('*');
    const { data: roles } = await supabase.from('user_roles').select('*');
    const roleMap: Record<string, string> = {};
    (roles || []).forEach((r: any) => { roleMap[r.user_id] = r.role; });
    const mapped = (profiles || []).filter((p: any) => {
      const role = roleMap[p.user_id];
      return role === 'lecturer' || role === 'hod' || role === 'hoy';
    }).map((p: any) => ({
      user_id: p.user_id,
      name: p.name,
      email: p.email || '',
      role: roleMap[p.user_id] || 'unknown',
      dept: p.dept || '',
      code: p.code || '',
    }));
    setFaculty(mapped);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (<>
    <div className="page-header">
      <div><div className="page-title">Faculty / Lecturers</div><div className="page-sub">{faculty.length} staff members</div></div>
    </div>
    <div className="card">
      {loading ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--text2)' }}>Loading...</div> : (
        <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Email</th><th>Status</th></tr></thead>
          <tbody>{faculty.map(l => (
            <tr key={l.user_id}>
              <td className="td-name"><div style={{display:'flex',alignItems:'center',gap:8}}><div className="avatar" style={{background:'#c8860a',width:28,height:28,fontSize:11}}>{l.name[0]}</div>{l.name}</div></td>
              <td><span className="badge badge-pass">{l.role.toUpperCase()}</span></td>
              <td>{l.dept || '—'}</td>
              <td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{l.email}</td>
              <td><span className="badge badge-active">Active</span></td>
            </tr>
          ))}</tbody></table></div>
      )}
    </div>
  </>);
}
