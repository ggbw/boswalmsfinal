import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade, gradeColor } from '@/data/db';

export default function MyModulesPage() {
  const { db, currentUser } = useApp();
  const stu = currentUser?.role === 'student' ? db.students.find(s => s.studentId === currentUser?.studentId || s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase()) : null;
  if (!stu) return <div className="card" style={{textAlign:'center',padding:40}}>This page is only available to students.</div>;
  const cls = db.classes.find(c => c.id === stu.classId);

  // Only modules student is enrolled in (via class + overrides)
  const classMods = db.modules.filter(m => m.classes.includes(stu.classId));
  const overrideModIds = db.studentModules.filter(sm => sm.studentId === stu.id).map(sm => sm.moduleId);
  const overrideMods = db.modules.filter(m => overrideModIds.includes(m.id) && !classMods.find(cm => cm.id === m.id));
  const mods = [...classMods, ...overrideMods];

  const marks = db.marks.filter(m => m.studentId === stu.studentId);
  const withMarks = marks.filter(mk => mods.find(m => m.id === mk.moduleId)).length;
  const passing = marks.filter(mk => mods.find(m => m.id === mk.moduleId) && calcModuleMark(mk) >= 50).length;
  const avgMark = withMarks ? Math.round(marks.filter(mk => mods.find(m => m.id === mk.moduleId)).reduce((a, mk) => a + calcModuleMark(mk), 0) / withMarks) : null;

  // Find lecturer for each module
  const getLecturer = (mod: typeof mods[0]) => {
    const modClasses = db.classes.filter(c => mod.classes.includes(c.id));
    const lecturers = [...new Set(modClasses.map(c => c.lecturer).filter(Boolean))];
    return lecturers.join(', ') || '—';
  };

  return (<>
    <div className="page-header"><div className="page-title"><i className="fa-solid fa-book-open" style={{marginRight:8,color:'var(--accent)'}}/> My Modules</div></div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:12,marginBottom:20}}>
      <div className="card" style={{textAlign:'center',padding:'14px 10px'}}><div style={{fontSize:26,fontWeight:800,color:'var(--accent2)'}}>{mods.length}</div><div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>Modules enrolled</div></div>
      <div className="card" style={{textAlign:'center',padding:'14px 10px'}}><div style={{fontSize:26,fontWeight:800}}>{withMarks}</div><div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>With marks</div></div>
      <div className="card" style={{textAlign:'center',padding:'14px 10px'}}><div style={{fontSize:26,fontWeight:800,color:'#27ae60'}}>{passing}</div><div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>Passing</div></div>
      <div className="card" style={{textAlign:'center',padding:'14px 10px'}}><div style={{fontSize:26,fontWeight:800,color:avgMark!==null?(avgMark>=50?'#27ae60':'var(--danger)'):'var(--text3)'}}>{avgMark!==null?avgMark+'%':'—'}</div><div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>Average</div></div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:16}}>
      {mods.map(m => {
        const mark = marks.find(mk => mk.moduleId === m.id);
        const mm = mark ? calcModuleMark(mark) : null;
        const g = mm !== null ? grade(mm) : null;
        const dept = db.departments.find(d => d.id === m.dept);
        const barColor = mm === null ? 'var(--border)' : mm >= 80 ? '#27ae60' : mm >= 50 ? 'var(--accent2)' : 'var(--danger)';
        const lecturer = getLecturer(m);
        return <div key={m.id} className="card" style={{padding:0,overflow:'hidden'}}>
          <div style={{height:4,background:barColor}}/>
          <div style={{padding:16}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
              <div><div style={{fontWeight:700,fontSize:14}}>{m.name}</div><div style={{fontSize:11,color:'var(--text2)',marginTop:2}}>{m.code}{dept?` · ${dept.name}`:''}</div></div>
              {g ? <span className={`badge ${gradeColor(g)}`}>{g}</span> : <span className="badge badge-inactive">No marks</span>}
            </div>
            <div style={{fontSize:11,color:'var(--text2)',marginBottom:8}}><i className="fa-solid fa-chalkboard-user" style={{marginRight:4}}/> {lecturer}</div>
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--text2)',marginBottom:4}}><span>Overall mark</span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:barColor}}>{mm!==null?mm+'%':'—'}</span></div>
              <div style={{height:6,background:'var(--surface2)',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${mm||0}%`,background:barColor,borderRadius:3,transition:'width .4s ease'}}/></div>
            </div>
          </div>
        </div>;
      })}
    </div>
  </>);
}
