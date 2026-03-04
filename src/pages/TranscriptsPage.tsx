import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade, gradeColor } from '@/data/db';
export default function TranscriptsPage() {
  const { db, currentUser, showModal } = useApp();
  const [search, setSearch] = useState('');
  const role = currentUser?.role;
  if (role === 'student') {
    const stu = db.students.find(s => s.studentId === currentUser?.studentId || s.name.split(' ')[0].toLowerCase() === (currentUser?.name||'').split(' ')[0].toLowerCase());
    if (!stu) return <div className="card" style={{textAlign:'center',padding:40}}>Student record not found.</div>;
    return <TranscriptView stu={stu} />;
  }
  const students = db.students;
  const filtered = students.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()));
  const showTranscript = (id: string) => {
    const s = db.students.find(x => x.id === id); if (!s) return;
    showModal('Student Transcript — ' + s.name, <TranscriptView stu={s} />, 'large');
  };
  return (<>
    <div className="page-header"><div className="page-title">Student Transcripts</div></div>
    <div className="card">
      <div className="search-bar"><input className="search-input" placeholder="Search student…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="table-wrap"><table><thead><tr><th>Student</th><th>Student ID</th><th>Class</th><th>Action</th></tr></thead>
        <tbody>{filtered.map(s=>{const cls=db.classes.find(c=>c.id===s.classId);return<tr key={s.id}><td className="td-name">{s.name}</td><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{s.studentId}</td><td>{cls?.name}</td><td><button className="btn btn-outline btn-sm" onClick={()=>showTranscript(s.id)}><i className="fa-solid fa-eye"/> View</button></td></tr>;})}</tbody>
      </table></div>
    </div>
  </>);
}

function TranscriptView({ stu }: { stu: any }) {
  const { db } = useApp();
  const cls = db.classes.find((c: any) => c.id === stu.classId);
  const prog = db.config.programmes.find((p: any) => p.id === stu.programme);
  const marks = db.marks.filter((m: any) => m.studentId === stu.studentId);
  return (
    <div className="card">
      <div style={{textAlign:'center',marginBottom:16,paddingBottom:14,borderBottom:'2px solid #d4920a'}}>
        <div style={{fontSize:18,fontWeight:700,color:'#0b1f4a'}}>BOSWA CULINARY INSTITUTE OF BOTSWANA</div>
        <div style={{fontSize:12,color:'#666',marginTop:2}}>Official Student Academic Transcript</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:16,background:'#f9f9f9',padding:12,borderRadius:6,fontSize:12}}>
        <div><strong>Student Name:</strong> {stu.name}</div><div><strong>Student ID:</strong> {stu.studentId}</div>
        <div><strong>Programme:</strong> {prog?.name}</div><div><strong>Class:</strong> {cls?.name}</div>
        <div><strong>Year:</strong> Year {stu.year}</div><div><strong>Semester:</strong> Semester {stu.semester}</div>
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead style={{background:'#0b1f4a',color:'#fff'}}><tr><th style={{padding:8,textAlign:'left'}}>Code</th><th style={{padding:8,textAlign:'left'}}>Module</th><th style={{padding:8,textAlign:'center'}}>CW 40%</th><th style={{padding:8,textAlign:'center'}}>Prac 20%</th><th style={{padding:8,textAlign:'center'}}>Exam 40%</th><th style={{padding:8,textAlign:'center'}}>Total</th><th style={{padding:8,textAlign:'center'}}>Grade</th></tr></thead>
        <tbody>{marks.map((m: any) => {const mod=db.modules.find((mo: any)=>mo.id===m.moduleId);const cw=Math.round(((m.test1+m.test2+m.practTest+m.indAss+m.grpAss)/5)*0.4);const pe=Math.round(m.practical*0.2);const fe=Math.round(m.finalExam*0.4);const mm=cw+pe+fe;const g=grade(mm);return<tr key={m.moduleId} style={{borderBottom:'1px solid #e0e0e0'}}><td style={{padding:8}}>{mod?.code}</td><td style={{padding:8}}>{mod?.name}</td><td style={{textAlign:'center',padding:8}}>{cw}%</td><td style={{textAlign:'center',padding:8}}>{pe}%</td><td style={{textAlign:'center',padding:8}}>{fe}%</td><td style={{textAlign:'center',fontWeight:700,padding:8}}>{mm}%</td><td style={{textAlign:'center',padding:8}}><span className={`badge ${gradeColor(g)}`}>{g}</span></td></tr>;})}</tbody>
      </table>
      <div style={{marginTop:10,fontSize:10,color:'#888'}}><em>Grading: 0–49% Fail | 50–59% Pass | 60–69% Credit | 70–79% Merit | 80%+ Distinction</em></div>
    </div>
  );
}
