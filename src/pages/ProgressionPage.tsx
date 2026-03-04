import { useApp } from '@/context/AppContext';
export default function ProgressionPage() {
  const { db, toast } = useApp();
  return (<>
    <div className="page-header"><div className="page-title">Student Progression / Promotion</div></div>
    <div className="notif-banner"><span style={{fontSize:16}}>ℹ️</span><div>HOD and HOY must approve student progression from Semester 1 → Semester 2 and from one academic year to the next.</div></div>
    {db.classes.map(cls=>{const students=db.students.filter(s=>s.classId===cls.id);const prog=db.config.programmes.find(p=>p.id===cls.programme);const nextSem=cls.semester<2?'Semester '+(cls.semester+1):'Year '+(cls.year+1)+' Semester 1';return(
      <div key={cls.id} className="card" style={{marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div><div style={{fontWeight:700,fontSize:14}}><i className="fa-solid fa-school"/> {cls.name}</div><div style={{fontSize:11,color:'var(--text2)',marginTop:3}}>{prog?.type} · Year {cls.year} Sem {cls.semester} → {nextSem}</div><div style={{fontSize:11,color:'var(--text2)'}}>{students.length} students</div></div>
          <button className="btn btn-green btn-sm" onClick={()=>toast(`Progression approved for ${cls.name}!`,'success')}>✓ Approve Progression</button>
        </div>
      </div>
    );})}
  </>);
}
