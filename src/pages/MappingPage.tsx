import { useApp } from '@/context/AppContext';
export default function MappingPage() {
  const { currentUser } = useApp();
  if (currentUser?.role !== 'admin' && currentUser?.role !== 'hod') {
    return <div className="card" style={{textAlign:'center',padding:40}}><i className="fa-solid fa-lock" style={{fontSize:32,color:'var(--text3)',marginBottom:12,display:'block'}}/><div style={{color:'var(--text2)'}}>Only Admin and HOD can manage module mappings.</div></div>;
  }
  return <MappingGrid />;
}

function MappingGrid() {
  const { db } = useApp();
  const classes = db.classes;
  const selCls = classes[0]?.id || '';
  const students = db.students.filter(s => s.classId === selCls).sort((a,b) => a.name.localeCompare(b.name));
  const allMods = db.modules;
  return (<>
    <div className="page-header"><div className="page-title"><i className="fa-solid fa-diagram-project" style={{marginRight:8,color:'var(--accent)'}}/> Module Mapping</div></div>
    <div className="card" style={{padding:0,overflow:'hidden'}}>
      <div className="table-wrap">
        <table style={{minWidth:600}}><thead><tr><th style={{minWidth:180,position:'sticky',left:0,background:'var(--surface2)',zIndex:2}}>Student</th>
          {allMods.map(m => <th key={m.id} style={{textAlign:'center',minWidth:70,fontSize:9,padding:'6px 4px'}}><div style={{fontFamily:"'JetBrains Mono',monospace",color:'var(--accent2)',fontWeight:700}}>{m.code}</div><div style={{fontSize:10,color:'var(--text2)'}}>{m.name}</div></th>)}
        </tr></thead>
        <tbody>{students.map(stu => (
          <tr key={stu.id}>
            <td style={{position:'sticky',left:0,background:'var(--surface)',zIndex:2,minWidth:180}}><div style={{display:'flex',alignItems:'center',gap:6}}><div className="avatar" style={{background:stu.gender==='Female'?'#8250df':'#1f6feb',width:24,height:24,fontSize:9}}>{stu.name[0]}</div><span style={{fontSize:12,fontWeight:500}}>{stu.name}</span></div></td>
            {allMods.map(m => {
              const isClass = m.classes?.includes(selCls);
              return <td key={m.id} style={{textAlign:'center',background:isClass?'rgba(39,174,96,.12)':'transparent'}}>{isClass?<i className="fa-solid fa-check" style={{color:'#27ae60',fontSize:13}}/>:''}</td>;
            })}
          </tr>
        ))}</tbody></table>
      </div>
    </div>
  </>);
}
