import { useState } from 'react';
import { useApp } from '@/context/AppContext';
export default function TimetablePage() {
  const { db } = useApp();
  const [filterCls, setFilterCls] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
  let slots = db.timetable;
  if (filterCls) slots = slots.filter(t => t.classId === filterCls);
  if (filterDay) slots = slots.filter(t => t.day === filterDay);
  return (<>
    <div className="page-header"><div><div className="page-title"><i className="fa-solid fa-calendar-days" style={{color:'var(--accent)',marginRight:8}}/>Timetable</div><div className="page-sub">{db.timetable.length} scheduled slot(s)</div></div></div>
    <div className="card" style={{marginBottom:14,padding:'12px 16px'}}>
      <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div className="form-group" style={{marginBottom:0,minWidth:160}}><label style={{fontSize:11}}>Class</label><select className="form-select" value={filterCls} onChange={e=>setFilterCls(e.target.value)}><option value="">All Classes</option>{db.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="form-group" style={{marginBottom:0,minWidth:140}}><label style={{fontSize:11}}>Day</label><select className="form-select" value={filterDay} onChange={e=>setFilterDay(e.target.value)}><option value="">All Days</option>{days.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
      </div>
    </div>
    <div className="card" style={{padding:0,overflow:'hidden'}}>
      <div className="table-wrap"><table><thead><tr><th>Day</th><th>Time</th><th>Class</th><th>Module</th><th>Lecturer</th><th>Room</th></tr></thead>
        <tbody>{days.map(day => {
          if (filterDay && filterDay !== day) return null;
          const daySlots = slots.filter(t => t.day === day).sort((a,b) => a.time.localeCompare(b.time));
          if (!daySlots.length) return null;
          return daySlots.map((t,i) => {
            const cls = db.classes.find(c => c.id === t.classId);
            const mod = db.modules.find(m => m.id === t.moduleId);
            return <tr key={t.id}><td style={{fontWeight:600,color:'var(--accent)'}}>{i===0?day:''}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,whiteSpace:'nowrap'}}>{t.time}</td><td style={{fontWeight:600}}>{cls?.name}</td><td>{mod?.name}</td><td style={{fontSize:11,color:'var(--text2)'}}>{cls?.lecturer||'—'}</td><td><span style={{background:'var(--surface2)',borderRadius:4,padding:'2px 8px',fontSize:11}}>{t.room}</span></td></tr>;
          });
        })}</tbody></table></div>
    </div>
  </>);
}
