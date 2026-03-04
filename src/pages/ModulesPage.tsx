import { useApp } from '@/context/AppContext';
export default function ModulesPage() {
  const { db } = useApp();
  return (<>
    <div className="page-header"><div className="page-title">Modules</div></div>
    <div className="card"><div className="table-wrap"><table><thead><tr><th>Code</th><th>Module Name</th><th>Department</th><th>Classes</th></tr></thead>
      <tbody>{db.modules.map(m => {
        const dept = db.departments.find(d => d.id === m.dept);
        const cls = m.classes.map(cid => db.classes.find(c => c.id === cid)?.name || cid).join(', ');
        return <tr key={m.id}><td style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{m.code}</td><td className="td-name">{m.name}</td><td>{dept?.name}</td><td style={{fontSize:11}}>{cls}</td></tr>;
      })}</tbody></table></div></div>
  </>);
}
