import { useApp } from '@/context/AppContext';
import { calcModuleMark, grade } from '@/data/db';
export default function ReportsPage() {
  const { db } = useApp();
  const GS = ['Distinction','Merit','Credit','Pass','Fail'];
  return (<>
    <div className="page-header"><div className="page-title">HOD / HOY Report</div></div>
    <div className="card" style={{padding:0,overflow:'hidden'}}>
      <div style={{background:'#0d1117',color:'#e6edf3',padding:'10px 16px',fontWeight:700,textAlign:'center'}}>Grade Analysis Report — {db.config.currentYear} · Sem {db.config.currentSemester}</div>
      <div className="table-wrap"><table><thead><tr><th>Class</th><th>Lecturer</th>{GS.map(g=><th key={g} style={{textAlign:'center'}}>{g}</th>)}<th style={{textAlign:'center'}}>Total</th><th style={{textAlign:'center'}}>Pass%</th></tr></thead>
        <tbody>{db.classes.map(cls=>{
          const students=db.students.filter(s=>s.classId===cls.id);
          const grades:Record<string,number>={Distinction:0,Merit:0,Credit:0,Pass:0,Fail:0};
          students.forEach(s=>{const sMarks=db.marks.filter(m=>m.studentId===s.studentId);if(sMarks.length){const avg=Math.round(sMarks.reduce((a,m)=>a+calcModuleMark(m),0)/sMarks.length);const g=grade(avg);if(grades[g]!==undefined)grades[g]++;}});
          const total=students.length;const passPct=total?Math.round((total-grades.Fail)/total*100):0;
          return<tr key={cls.id}><td className="td-name">{cls.name}</td><td style={{fontSize:11,color:'var(--text2)'}}>{cls.lecturer}</td>{GS.map(g=><td key={g} style={{textAlign:'center',fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:grades[g]>0?'var(--text)':'#d0d7de'}}>{grades[g]}</td>)}<td style={{textAlign:'center',fontWeight:700,fontFamily:"'JetBrains Mono',monospace"}}>{total}</td><td style={{textAlign:'center',fontWeight:700,color:passPct>=50?'#1a7f37':'#cf222e'}}>{passPct}%</td></tr>;
        })}</tbody></table></div>
    </div>
  </>);
}
